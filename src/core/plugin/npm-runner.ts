import { execFile } from 'node:child_process'

export interface ProcessResult {
    stdout: string
    stderr: string
}

export interface ProcessOptions {
    cwd?: string | undefined
    timeoutMs: number
    signal?: AbortSignal | undefined
    shell?: boolean | undefined
}

export class ProcessError extends Error {
    readonly stdout: string
    readonly stderr: string

    constructor(message: string, stdout: string, stderr: string) {
        super(message)
        this.name = 'ProcessError'
        this.stdout = stdout
        this.stderr = stderr
    }
}

function tail(text: string, limit = 2_000): string {
    const trimmed = text.trim()

    return trimmed.length <= limit ? trimmed : trimmed.slice(-limit)
}

export function runProcess(
    file: string,
    args: string[],
    options: ProcessOptions
): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        execFile(
            file,
            args,
            {
                ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
                timeout: options.timeoutMs,
                maxBuffer: 2 * 1024 * 1024,
                windowsHide: true,
                env: {
                    ...process.env,
                    npm_config_update_notifier: 'false',
                },
                ...(options.signal !== undefined
                    ? { signal: options.signal }
                    : {}),
                ...(options.shell !== undefined
                    ? { shell: options.shell }
                    : {}),
            },
            (error, stdout, stderr) => {
                if (error === null) {
                    resolve({ stdout, stderr })
                    return
                }

                const detail = tail(stderr) || tail(stdout)

                if (
                    error.name === 'AbortError' ||
                    (error as { code?: unknown }).code === 'ABORT_ERR'
                ) {
                    reject(new ProcessError('操作已取消', stdout, stderr))
                    return
                }

                if (error.killed) {
                    reject(
                        new ProcessError(
                            `命令超时（${options.timeoutMs}ms）`,
                            stdout,
                            stderr
                        )
                    )
                    return
                }

                reject(
                    new ProcessError(
                        detail.length > 0
                            ? `命令执行失败：${detail}`
                            : '命令执行失败',
                        stdout,
                        stderr
                    )
                )
            }
        )
    })
}

export interface NpmRunner {
    run(args: string[], options: ProcessOptions): Promise<ProcessResult>
}

export class NpmCliRunner implements NpmRunner {
    private readonly binary: string

    constructor(binary = 'npm') {
        this.binary = binary
    }

    run(args: string[], options: ProcessOptions): Promise<ProcessResult> {
        if (process.platform === 'win32') {
            return runProcess('npm', args, {
                ...options,
                shell: true,
            })
        }

        return runProcess(this.binary, args, options)
    }
}
