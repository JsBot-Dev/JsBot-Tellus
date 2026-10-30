import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import {
    appConfigSchema,
    formatConfigIssues,
    type AppConfig,
    type PluginEnvelope,
} from '../config/schema.js'
import { stripPluginEnvelope } from '../plugin/host.js'
import type { AnyPluginDefinition } from '../plugin/types.js'
import type {
    ConfigApplyResult,
    ConfigDocument,
    ConfigValidationIssue,
    ConfigValidationResult,
} from './types.js'

export class ConfigStoreError extends Error {
    readonly status: number
    readonly issues: ConfigValidationIssue[]

    constructor(
        status: number,
        message: string,
        issues: ConfigValidationIssue[] = []
    ) {
        super(message)
        this.name = 'ConfigStoreError'
        this.status = status
        this.issues = issues
    }
}

export interface ConfigStoreOptions {
    configPath: string
    getPlugins(): AnyPluginDefinition[]
    restart(): Promise<boolean>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}

export function mergeSecrets(current: AppConfig, incoming: unknown): unknown {
    if (!isRecord(incoming)) return incoming

    const next = asRecord(JSON.parse(JSON.stringify(incoming)))
    const accessToken = next['accessToken']

    if (accessToken === null) {
        delete next['accessToken']
    } else if (accessToken === undefined || accessToken === '') {
        if (current.accessToken !== undefined) {
            next['accessToken'] = current.accessToken
        } else {
            delete next['accessToken']
        }
    }

    const webui = next['webui']

    if (isRecord(webui)) {
        const password = webui['password']

        if (password === null) {
            delete webui['password']
        } else if (password === undefined || password === '') {
            if (current.webui.password !== undefined) {
                webui['password'] = current.webui.password
            } else {
                delete webui['password']
            }
        }
    }

    return next
}

export interface MaskedConfig {
    config: Record<string, unknown>
    accessTokenSet: boolean
    webuiPasswordSet: boolean
}

export function maskConfig(config: AppConfig): MaskedConfig {
    const masked = asRecord(JSON.parse(JSON.stringify(config)))
    let accessTokenSet = false
    let webuiPasswordSet = false

    if (typeof masked['accessToken'] === 'string') {
        masked['accessToken'] = ''
        accessTokenSet = true
    }

    const webui = asRecord(masked['webui'])

    if (typeof webui['password'] === 'string') {
        webui['password'] = ''
        webuiPasswordSet = true
    }

    return { config: masked, accessTokenSet, webuiPasswordSet }
}

function issuesFrom(
    zodIssues: Array<{ path: PropertyKey[]; message: string }>
): ConfigValidationIssue[] {
    return zodIssues.map((issue) => {
        const path = issue.path
            .map((part) => String(part))
            .filter((part) => part !== '')
            .join('.')

        return { path, message: issue.message }
    })
}

function validatePlugins(
    config: AppConfig,
    definitions: AnyPluginDefinition[]
): ConfigValidationIssue[] {
    const issues: ConfigValidationIssue[] = []
    const byId = new Map(
        definitions.map((definition) => [definition.manifest.id, definition])
    )

    for (const [id, envelope] of Object.entries(config.plugins)) {
        const definition = byId.get(id)

        if (!definition) {
            issues.push({
                path: `plugins.${id}`,
                message: `unknown plugin id: ${id}`,
            })

            continue
        }

        const enabled =
            (envelope as PluginEnvelope).enabled ??
            definition.manifest.defaultEnabled ??
            false

        if (!enabled) continue

        const result = definition.manifest.configSchema.safeParse(
            stripPluginEnvelope(envelope as PluginEnvelope)
        )

        if (!result.success) {
            issues.push(
                ...issuesFrom(result.error.issues).map((issue) => ({
                    path: `plugins.${id}${issue.path.length > 0 ? `.${issue.path}` : ''}`,
                    message: issue.message,
                }))
            )
        }
    }

    return issues
}

async function atomicWrite(filePath: string, raw: string): Promise<void> {
    let mode: number | undefined

    try {
        mode = (await stat(filePath)).mode & 0o777
    } catch {
        mode = undefined
    }

    const temporary = `${filePath}.tmp-${randomUUID()}`

    await writeFile(temporary, raw, {
        encoding: 'utf8',
        ...(mode !== undefined ? { mode } : {}),
    })

    try {
        await copyFile(filePath, `${filePath}.bak`)
    } catch {
        // Missing source file; nothing to back up.
    }

    await rename(temporary, filePath)
}

async function restoreRaw(filePath: string, raw: string): Promise<void> {
    const temporary = `${filePath}.tmp-${randomUUID()}`

    await writeFile(temporary, raw, 'utf8')
    await rename(temporary, filePath)
}

export class ConfigStore {
    private tail: Promise<unknown> = Promise.resolve()

    constructor(private readonly options: ConfigStoreOptions) {}

    async read(): Promise<ConfigDocument> {
        let raw: string

        try {
            raw = await readFile(this.options.configPath, 'utf8')
        } catch (error) {
            throw new ConfigStoreError(
                500,
                `cannot read config file: ${this.options.configPath}`,
                []
            )
        }

        let json: unknown

        try {
            json = JSON.parse(raw) as unknown
        } catch {
            throw new ConfigStoreError(
                500,
                `invalid JSON in config file: ${this.options.configPath}`
            )
        }

        const parsed = appConfigSchema.safeParse(json)

        if (!parsed.success) {
            throw new ConfigStoreError(
                500,
                'invalid config file',
                issuesFrom(parsed.error.issues)
            )
        }

        return {
            path: this.options.configPath,
            raw,
            hash: createHash('sha256').update(raw).digest('hex'),
            config: parsed.data,
        }
    }

    async validate(value: unknown): Promise<ConfigValidationResult> {
        const document = await this.read()
        const merged = mergeSecrets(document.config, value)
        const parsed = appConfigSchema.safeParse(merged)

        if (!parsed.success) {
            return {
                ok: false,
                issues: issuesFrom(parsed.error.issues),
            }
        }

        return {
            ok: true,
            issues: validatePlugins(parsed.data, this.options.getPlugins()),
            config: parsed.data,
        }
    }

    apply(value: unknown, baseHash?: string): Promise<ConfigApplyResult> {
        return this.serialize(async () => {
            const document = await this.read()

            if (baseHash !== undefined && baseHash !== document.hash) {
                throw new ConfigStoreError(
                    409,
                    '配置文件已被外部修改，请刷新后重试'
                )
            }

            const merged = mergeSecrets(document.config, value)
            const parsed = appConfigSchema.safeParse(merged)

            if (!parsed.success) {
                throw new ConfigStoreError(
                    400,
                    '配置校验失败',
                    issuesFrom(parsed.error.issues)
                )
            }

            const pluginIssues = validatePlugins(
                parsed.data,
                this.options.getPlugins()
            )

            if (pluginIssues.length > 0) {
                throw new ConfigStoreError(
                    400,
                    '插件配置校验失败',
                    pluginIssues
                )
            }

            const serialized = `${JSON.stringify(parsed.data, null, 4)}\n`

            await atomicWrite(this.options.configPath, serialized)

            if (await this.options.restart()) {
                const after = await this.read()

                return { ok: true, hash: after.hash }
            }

            await restoreRaw(this.options.configPath, document.raw)

            const restored = await this.options.restart()

            return {
                ok: false,
                error: restored
                    ? '运行时重启失败，已恢复旧配置'
                    : '运行时重启失败，已恢复旧配置，但恢复重启也未成功',
            }
        })
    }

    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const run = this.tail.then(task, task)

        this.tail = run.then(
            () => undefined,
            () => undefined
        )

        return run
    }
}
