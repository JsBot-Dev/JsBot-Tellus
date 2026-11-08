import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
    appConfigSchema,
    formatConfigIssues,
    pluginEnvelopeSchema,
    type AppConfig,
    type PluginEnvelope,
} from '../config/schema.js'
import { legacyPluginsMessage, stripLegacyPlugins } from '../config/loader.js'
import {
    readPluginConfig as readPluginConfigFile,
    readPluginConfigs as readPluginConfigFiles,
    restorePluginConfig,
    writePluginConfig,
    type PluginConfigDocument,
} from '../config/plugin-config.js'
import { atomicWrite, restoreRaw } from '../config/atomic.js'
import { parseJsonc } from '../config/jsonc.js'
import { stripPluginEnvelope } from '../plugin/host.js'
import type { AnyPluginDefinition } from '../plugin/types.js'
import { HttpError } from './http.js'
import type {
    ConfigApplyResult,
    ConfigDocument,
    ConfigValidationIssue,
    ConfigValidationResult,
} from './types.js'

export class ConfigStoreError extends HttpError {
    readonly issues: ConfigValidationIssue[]

    constructor(
        status: number,
        message: string,
        issues: ConfigValidationIssue[] = []
    ) {
        super(status, message, issues)
        this.name = 'ConfigStoreError'
        this.issues = issues
    }
}

export interface ConfigStoreOptions {
    configPath: string
    pluginConfigDir: string
    getPlugins(): AnyPluginDefinition[]
    restart(): Promise<boolean>
    onWarning?: ((message: string) => void) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}

function pickEnvelope(value: PluginEnvelope): PluginEnvelope {
    return {
        ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
        ...(value.private !== undefined ? { private: value.private } : {}),
        ...(value.groups !== undefined ? { groups: value.groups } : {}),
    }
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

function pluginIssuesFrom(
    zodIssues: Array<{ path: PropertyKey[]; message: string }>,
    pluginId: string
): ConfigValidationIssue[] {
    return issuesFrom(zodIssues).map((issue) => ({
        ...issue,
        path: issue.path.length > 0 ? `${pluginId}.${issue.path}` : pluginId,
    }))
}

export class ConfigStore {
    private tail: Promise<unknown> = Promise.resolve()
    private warnedLegacyPlugins = false

    constructor(private readonly options: ConfigStoreOptions) {}

    private warnLegacyPlugins(): void {
        if (this.warnedLegacyPlugins) return

        this.warnedLegacyPlugins = true
        this.options.onWarning?.(
            legacyPluginsMessage(this.options.pluginConfigDir)
        )
    }

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

        const jsonc = parseJsonc(raw)

        if (jsonc.error !== null) {
            throw new ConfigStoreError(
                500,
                `invalid JSONC in config file: ${this.options.configPath}: ${jsonc.error}`
            )
        }

        const stripped = stripLegacyPlugins(jsonc.value)

        if (stripped.ignored) this.warnLegacyPlugins()

        const parsed = appConfigSchema.safeParse(stripped.value)

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
        const stripped = stripLegacyPlugins(
            mergeSecrets(document.config, value)
        )

        if (stripped.ignored) this.warnLegacyPlugins()

        const parsed = appConfigSchema.safeParse(stripped.value)

        if (!parsed.success) {
            return {
                ok: false,
                issues: issuesFrom(parsed.error.issues),
            }
        }

        return {
            ok: true,
            issues: [],
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

            const stripped = stripLegacyPlugins(
                mergeSecrets(document.config, value)
            )

            if (stripped.ignored) this.warnLegacyPlugins()

            const parsed = appConfigSchema.safeParse(stripped.value)

            if (!parsed.success) {
                throw new ConfigStoreError(
                    400,
                    '配置校验失败',
                    issuesFrom(parsed.error.issues)
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

    readPluginConfigs(): Promise<PluginConfigDocument[]> {
        return readPluginConfigFiles(this.options.pluginConfigDir).catch(
            (error) => {
                throw new ConfigStoreError(
                    500,
                    `cannot read plugin config directory: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                )
            }
        )
    }

    readPluginConfig(id: string): Promise<PluginConfigDocument> {
        return readPluginConfigFile(this.options.pluginConfigDir, id)
    }

    applyPlugin(
        id: string,
        value: unknown,
        baseHash?: string | null
    ): Promise<ConfigApplyResult> {
        return this.serialize(async () => {
            const definition = this.options
                .getPlugins()
                .find((plugin) => plugin.manifest.id === id)

            if (definition === undefined) {
                throw new ConfigStoreError(404, `unknown plugin: ${id}`)
            }

            const document = await readPluginConfigFile(
                this.options.pluginConfigDir,
                id
            )

            if (
                typeof baseHash === 'string' &&
                baseHash.length > 0 &&
                baseHash !== document.hash
            ) {
                throw new ConfigStoreError(
                    409,
                    '插件配置文件已被外部修改，请刷新后重试'
                )
            }

            const envelope = pluginEnvelopeSchema.safeParse(value)

            if (!envelope.success) {
                throw new ConfigStoreError(
                    400,
                    `插件配置校验失败: ${formatConfigIssues(
                        envelope.error,
                        id
                    )}`,
                    pluginIssuesFrom(envelope.error.issues, id)
                )
            }

            const parsed = definition.manifest.configSchema.safeParse(
                stripPluginEnvelope(envelope.data)
            )

            if (!parsed.success) {
                throw new ConfigStoreError(
                    400,
                    `插件配置校验失败: ${formatConfigIssues(parsed.error, id)}`,
                    pluginIssuesFrom(parsed.error.issues, id)
                )
            }

            if (!isRecord(parsed.data)) {
                throw new ConfigStoreError(
                    400,
                    `plugin ${id}: config schema must produce an object`
                )
            }

            const next = {
                ...parsed.data,
                ...pickEnvelope(envelope.data),
            }

            await writePluginConfig(this.options.pluginConfigDir, id, next)

            if (await this.options.restart()) {
                const after = await readPluginConfigFile(
                    this.options.pluginConfigDir,
                    id
                )

                return after.hash === null
                    ? { ok: true }
                    : { ok: true, hash: after.hash }
            }

            await restorePluginConfig(
                this.options.pluginConfigDir,
                id,
                document.raw
            )

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
