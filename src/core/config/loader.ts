import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
    appConfigSchema,
    formatConfigIssues,
    type AppConfig,
} from './schema.js'

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

function pickFirst(...values: Array<string | undefined>): string | undefined {
    return values.find(
        (value) => value !== undefined && value.trim().length > 0
    )
}

export function resolveConfigPath(options: PathOptions = {}): string {
    const cwd = options.cwd ?? process.cwd()
    const env = options.env ?? process.env
    const value =
        pickFirst(options.config, env.BOT_CONFIG) ?? 'bot.config.v2.json'

    return resolve(cwd, value)
}

export function resolveDataDir(options: PathOptions = {}): string {
    const cwd = options.cwd ?? process.cwd()
    const env = options.env ?? process.env
    const value = pickFirst(options.dataDir, env.BOT_DATA_DIR) ?? 'data-v2'

    return resolve(cwd, value)
}

export async function loadConfig(filePath: string): Promise<AppConfig> {
    const absolutePath = resolve(filePath)

    let raw: string

    try {
        raw = await readFile(absolutePath, 'utf8')
    } catch (error) {
        throw new ConfigError(`cannot read config file: ${absolutePath}`, {
            cause: error,
        })
    }

    let json: unknown

    try {
        json = JSON.parse(raw)
    } catch (error) {
        throw new ConfigError(`invalid JSON in config file: ${absolutePath}`, {
            cause: error,
        })
    }

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
