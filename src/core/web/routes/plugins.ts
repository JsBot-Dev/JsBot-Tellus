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
    // The kernel can fail to start (for example when a plugin has no config
    // yet). Keep serving the last loaded definitions so the WebUI can still
    // edit plugin configs and recover without touching the file by hand.
    const definitions = runtime?.plugins ?? ctx.deps.getPlugins()
    const statuses = new Map(
        (runtime?.kernel.listPlugins() ?? []).map((entry) => [entry.id, entry])
    )
    const document = await ctx.deps.readConfig()
    const plugins = definitions.map((definition) => {
        const id = definition.manifest.id
        const status = statuses.get(id)
        const envelope = asRecord(document.config.plugins[id]) as Record<
            string,
            unknown
        >
        // `safeStringify` treats shared references as circular; cloning keeps
        // `config` and `options` from aliasing the same nested objects.
        const options = structuredClone(
            stripPluginEnvelope(envelope as never)
        ) as Record<string, unknown>
        const enabled =
            status?.enabled ??
            (typeof envelope['enabled'] === 'boolean'
                ? envelope['enabled']
                : (definition.manifest.defaultEnabled ?? false))

        return {
            id,
            version: definition.manifest.version,
            description: definition.manifest.description,
            dependencies: definition.manifest.dependencies ?? [],
            defaultEnabled: definition.manifest.defaultEnabled ?? false,
            enabled,
            loaded: status?.loaded ?? false,
            config: envelope,
            options,
            configSchema: pluginJsonSchema(definition),
        }
    })
    const installer = runtime?.installer
    const installed =
        installer !== undefined && installer.enabled
            ? await installer.list()
            : []

    sendData(ctx.res, 200, {
        plugins,
        installed,
        installerEnabled: installer?.enabled ?? false,
        configHash: document.hash,
    })
}

export async function handlePluginConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = ctx.segments[2]
    const document = await ctx.deps.readConfig()

    if (id === undefined) throw new HttpError(404, 'unknown plugin')

    const runtime = ctx.deps.getRuntime()
    const definition = (runtime?.plugins ?? ctx.deps.getPlugins()).find(
        (plugin) => plugin.manifest.id === id
    )
    const entry = document.config.plugins[id]

    if (definition === undefined && entry === undefined) {
        throw new HttpError(404, `unknown plugin: ${id}`)
    }

    const existing = asRecord(entry) as unknown as Record<string, unknown>
    const next = { ...existing }

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

        const options: Record<string, unknown> = {}

        for (const [key, value] of Object.entries(body['options'])) {
            if (!ENVELOPE_KEYS.has(key)) options[key] = value
        }

        for (const key of Object.keys(next)) {
            if (!ENVELOPE_KEYS.has(key)) delete next[key]
        }

        if (definition === undefined) {
            // Without a live runtime there is no schema to enforce; the config
            // store still owns envelope validation.
            Object.assign(next, options)
        } else {
            const parsed = definition.manifest.configSchema.safeParse(options)

            if (!parsed.success) {
                throw new HttpError(
                    400,
                    formatConfigIssues(parsed.error, `plugins.${id}`)
                )
            }

            if (!isRecord(parsed.data)) {
                throw new HttpError(
                    400,
                    `plugins.${id}: config schema must produce an object`
                )
            }

            Object.assign(next, parsed.data)
        }
    }

    const config = {
        ...document.config,
        plugins: {
            ...document.config.plugins,
            [id]: next,
        },
    }
    const baseHash = body['baseHash']

    sendData(
        ctx.res,
        200,
        await ctx.deps.applyConfig(
            config,
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
