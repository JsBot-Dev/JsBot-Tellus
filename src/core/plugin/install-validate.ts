import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathExists, VALIDATE_SCRIPT_FILE } from './install-dir.js'
import { runProcess } from './npm-runner.js'

export interface ValidatedPlugin {
    id: string
    version: string
    dependencies: string[]
}

export interface ValidateOptions {
    timeoutMs: number
    signal?: AbortSignal | undefined
    script?: string | undefined
}

async function findValidationScript(directory: string): Promise<string> {
    let current = dirname(directory)

    for (;;) {
        const script = join(current, '.jsbot', VALIDATE_SCRIPT_FILE)

        if (await pathExists(script)) return script

        const parent = dirname(current)

        if (parent === current) break

        current = parent
    }

    throw new Error('找不到插件校验脚本，请重新执行安装')
}

export type PackageValidator = (
    directory: string,
    name: string,
    options: ValidateOptions
) => Promise<ValidatedPlugin[]>

export const PLUGIN_MARKER = '__JSBOT_PLUGIN__'

export const validateInstalledPackage: PackageValidator = async (
    directory,
    name,
    options
) => {
    const absolute = resolve(directory)
    const dist = join(absolute, 'dist')
    const info = await stat(dist).catch(() => null)

    if (!info?.isDirectory()) {
        throw new Error(`插件包缺少 dist 目录: ${name}`)
    }

    const script = options.script ?? (await findValidationScript(absolute))
    const { stdout } = await runProcess(process.execPath, [script, absolute], {
        cwd: absolute,
        timeoutMs: options.timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })

    const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.startsWith(PLUGIN_MARKER))

    if (line === undefined) {
        throw new Error('插件校验没有返回结果')
    }

    let parsed: unknown

    try {
        parsed = JSON.parse(line.slice(PLUGIN_MARKER.length))
    } catch (error) {
        throw new Error('插件校验结果无法解析', { cause: error })
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('插件校验结果为空')
    }

    return parsed.map((item) => {
        if (
            typeof item !== 'object' ||
            item === null ||
            typeof (item as Record<string, unknown>)['id'] !== 'string'
        ) {
            throw new Error('插件校验结果格式无效')
        }

        const record = item as Record<string, unknown>

        return {
            id: record['id'] as string,
            version:
                typeof record['version'] === 'string'
                    ? record['version']
                    : '0.0.0',
            dependencies: Array.isArray(record['dependencies'])
                ? record['dependencies'].filter(
                      (value): value is string => typeof value === 'string'
                  )
                : [],
        }
    })
}
