import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
    appConfigSchema,
    formatConfigIssues,
    type AppConfig,
} from './schema.js'
import { parseJsonc } from './jsonc.js'

export const DEFAULT_CONFIG_FILE = 'bot.config.jsonc'
export const LEGACY_CONFIG_FILE = 'bot.config.json'

export class ConfigError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'ConfigError'
    }
}

export interface PathOptions {
    config?: string | undefined
    dataDir?: string | undefined
    env?: NodeJS.ProcessEnv | undefined
    cwd?: string | undefined
}

export interface LoadConfigOptions {
    pluginConfigDir?: string | undefined
}

function pickFirst(...values: Array<string | undefined>): string | undefined {
    return values.find(
        (value) => value !== undefined && value.trim().length > 0
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function legacyPluginsMessage(pluginConfigDir?: string): string {
    const directory = pluginConfigDir ?? '<data-dir>/config/plugin'

    return [
        '主配置文件不再支持 "plugins" 字段（3.0 起插件配置已拆分）。',
        `请手动将每个插件配置移动到 ${directory}/<id>.jsonc，并删除 "plugins" 字段。`,
        '本版本不会自动迁移旧配置。',
    ].join('\n')
}

export function assertNoLegacyPlugins(
    value: unknown,
    pluginConfigDir?: string
): void {
    if (isRecord(value) && 'plugins' in value) {
        throw new ConfigError(legacyPluginsMessage(pluginConfigDir))
    }
}

export function resolveConfigPath(options: PathOptions = {}): string {
    const cwd = options.cwd ?? process.cwd()
    const env = options.env ?? process.env
    const value = pickFirst(options.config, env.BOT_CONFIG)

    if (value !== undefined) return resolve(cwd, value)

    const preferred = resolve(cwd, DEFAULT_CONFIG_FILE)

    if (existsSync(preferred)) return preferred

    const legacy = resolve(cwd, LEGACY_CONFIG_FILE)

    if (existsSync(legacy)) return legacy

    return preferred
}

export function resolveDataDir(options: PathOptions = {}): string {
    const cwd = options.cwd ?? process.cwd()
    const env = options.env ?? process.env
    const value = pickFirst(options.dataDir, env.BOT_DATA_DIR) ?? 'data'

    return resolve(cwd, value)
}

export async function loadConfig(
    filePath: string,
    options: LoadConfigOptions = {}
): Promise<AppConfig> {
    const absolutePath = resolve(filePath)

    let raw: string

    try {
        raw = await readFile(absolutePath, 'utf8')
    } catch (error) {
        throw new ConfigError(`cannot read config file: ${absolutePath}`, {
            cause: error,
        })
    }

    const jsonc = parseJsonc(raw)

    if (jsonc.error !== null) {
        throw new ConfigError(
            `invalid JSONC in config file: ${absolutePath}: ${jsonc.error}`
        )
    }

    const json = jsonc.value

    assertNoLegacyPlugins(json, options.pluginConfigDir)

    const result = appConfigSchema.safeParse(json)

    if (!result.success) {
        throw new ConfigError(
            [
                `invalid config file: ${absolutePath}`,
                formatConfigIssues(result.error),
            ].join('\n'),
            { cause: result.error }
        )
    }

    return result.data
}
