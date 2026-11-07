import { z } from 'zod'
import { formatConfigIssues } from '../../config/schema.js'
import { stripPluginEnvelope } from '../../plugin/host.js'
import type { AnyPluginDefinition } from '../../plugin/types.js'
import { HttpError, isRecord, readJsonBody, sendData } from '../http.js'
import { asRecord, requireRuntime, type ApiContext } from './shared.js'

const ENVELOPE_KEYS = new Set(['enabled', 'private', 'groups'])

/**
 * JSON Schema for a plugin's options, derived from its Zod input schema once
 * per definition. `null` means the schema cannot be represented and the WebUI
 * falls back to raw JSON editing.
 */
const jsonSchemaCache = new WeakMap<
    AnyPluginDefinition,
    Record<string, unknown> | null
>()

function pluginJsonSchema(
    definition: AnyPluginDefinition
): Record<string, unknown> | null {
    if (jsonSchemaCache.has(definition)) {
        return jsonSchemaCache.get(definition) ?? null
    }

    let result: Record<string, unknown> | null = null

    try {
        result = z.toJSONSchema(definition.manifest.configSchema, {
            io: 'input',
            unrepresentable: 'any',
        }) as Record<string, unknown>
    } catch {
        result = null
    }

    jsonSchemaCache.set(definition, result)

    return result
}

export async function handlePluginsList(ctx: ApiContext): Promise<void> {
    const runtime = ctx.deps.getRuntime()
    // The kernel can fail to start (for example when a plugin setup fails).
    // Keep serving the last loaded definitions so the WebUI can still edit
    // plugin configs and recover without touching the file by hand.
    const definitions = runtime?.plugins ?? ctx.deps.getPlugins()
    const statuses = new Map(
        (runtime?.kernel.listPlugins() ?? []).map((entry) => [entry.id, entry])
    )
    const plugins = await Promise.all(
        definitions.map(async (definition) => {
            const id = definition.manifest.id
            const status = statuses.get(id)
            const document = await ctx.deps.readPluginConfig(id)
            const config = document.config as Record<string, unknown>
            // `safeStringify` treats shared references as circular; cloning keeps
            // `config` and `options` from aliasing the same nested objects.
            const options = structuredClone(
                stripPluginEnvelope(document.config)
            ) as Record<string, unknown>
            const schemaResult =
                document.error === null && !document.missing
                    ? definition.manifest.configSchema.safeParse(options)
                    : null
            const configError =
                document.error ??
                (schemaResult !== null && !schemaResult.success
                    ? formatConfigIssues(schemaResult.error, id)
                    : null)
            const enabled =
                status?.enabled ??
                (typeof config['enabled'] === 'boolean'
                    ? config['enabled']
                    : (definition.manifest.defaultEnabled ?? false))

            return {
                id,
                version: definition.manifest.version,
                description: definition.manifest.description,
                dependencies: definition.manifest.dependencies ?? [],
                defaultEnabled: definition.manifest.defaultEnabled ?? false,
                enabled,
                loaded: status?.loaded ?? false,
                config,
                options,
                configHash: document.hash,
                configPath: document.path,
                configMissing: document.missing,
                configError,
                configSchema: pluginJsonSchema(definition),
            }
        })
    )
    const installer = runtime?.installer
    const installed =
        installer !== undefined && installer.enabled
            ? await installer.list()
            : []

    sendData(ctx.res, 200, {
        plugins,
        installed,
        installerEnabled: installer?.enabled ?? false,
    })
}

export async function handlePluginConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = ctx.segments[2]

    if (id === undefined) throw new HttpError(404, 'unknown plugin')

    const runtime = ctx.deps.getRuntime()
    const definition = (runtime?.plugins ?? ctx.deps.getPlugins()).find(
        (plugin) => plugin.manifest.id === id
    )

    if (definition === undefined) {
        throw new HttpError(404, `unknown plugin: ${id}`)
    }

    const document = await ctx.deps.readPluginConfig(id)

    if (document.error !== null && body['options'] === undefined) {
        throw new HttpError(400, '插件配置文件无法解析，请打开配置并重新保存')
    }

    const next = {
        ...(document.config as Record<string, unknown>),
    }

    if (typeof body['enabled'] === 'boolean') {
        next['enabled'] = body['enabled']
    }

    if (typeof body['private'] === 'boolean') {
        next['private'] = body['private']
    }

    if (body['groups'] !== undefined) next['groups'] = body['groups']

    if (body['options'] !== undefined) {
        if (!isRecord(body['options'])) {
            throw new HttpError(400, 'options must be an object')
        }

        for (const key of Object.keys(next)) {
            if (!ENVELOPE_KEYS.has(key)) delete next[key]
        }

        for (const [key, value] of Object.entries(body['options'])) {
            if (!ENVELOPE_KEYS.has(key)) next[key] = value
        }
    }

    const baseHash = body['baseHash']

    sendData(
        ctx.res,
        200,
        await ctx.deps.applyPluginConfig(
            id,
            next,
            typeof baseHash === 'string' ? baseHash : undefined
        )
    )
}

export async function handleInstallerAction(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)

    if (!runtime.installer.enabled) {
        throw new HttpError(403, '插件安装器未启用')
    }

    const body = asRecord(await readJsonBody(ctx.req))
    const target = typeof body['target'] === 'string' ? body['target'] : ''
    const spec = typeof body['spec'] === 'string' ? body['spec'] : ''

    if (ctx.pathname.endsWith('/install')) {
        if (!spec) throw new HttpError(400, 'spec is required')

        sendData(
            ctx.res,
            200,
            await ctx.deps.runExclusive(() => runtime.installer.install(spec))
        )

        return
    }

    if (ctx.pathname.endsWith('/check-updates')) {
        sendData(
            ctx.res,
            200,
            await runtime.installer.checkUpdates(target || undefined)
        )

        return
    }

    if (ctx.pathname.endsWith('/update')) {
        sendData(
            ctx.res,
            200,
            await ctx.deps.runExclusive(() =>
                runtime.installer.update(target || undefined)
            )
        )

        return
    }

    sendData(
        ctx.res,
        200,
        await ctx.deps.runExclusive(async () =>
            runtime.installer.remove(target, undefined, {
                force: body['force'] === true,
            })
        )
    )
}
