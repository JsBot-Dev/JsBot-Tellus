import { join } from 'node:path'
import { VALIDATE_SCRIPT_FILE } from './install-dir.js'
import { runProcess } from './npm-runner.js'

export interface ValidatedPlugin {
    id: string
    version: string
    dependencies: string[]
}

export interface ValidateOptions {
    timeoutMs: number
    signal?: AbortSignal | undefined
}

export type PackageValidator = (
    dir: string,
    name: string,
    options: ValidateOptions
) => Promise<ValidatedPlugin[]>

export const PLUGIN_MARKER = '__JSBOT_PLUGIN__'

export const validateInstalledPackage: PackageValidator = async (
    dir,
    name,
    options
) => {
    const script = join(dir, '.jsbot', VALIDATE_SCRIPT_FILE)
    const { stdout } = await runProcess(process.execPath, [script, name], {
        cwd: dir,
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
