import { stripPluginEnvelope } from '../../plugin/host.js'
import { HttpError, isRecord, readJsonBody, sendData } from '../http.js'
import { asRecord, requireRuntime, type ApiContext } from './shared.js'

const ENVELOPE_KEYS = new Set(['enabled', 'private', 'groups'])

export async function handlePluginsList(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const statuses = new Map(
        runtime.kernel.listPlugins().map((entry) => [entry.id, entry])
    )
    const plugins = runtime.plugins.map((definition) => {
        const id = definition.manifest.id
        const status = statuses.get(id)
        const envelope = asRecord(runtime.config.plugins[id]) as Record<
            string,
            unknown
        >

        return {
            id,
            version: definition.manifest.version,
            description: definition.manifest.description,
            dependencies: definition.manifest.dependencies ?? [],
            defaultEnabled: definition.manifest.defaultEnabled ?? false,
            enabled: status?.enabled ?? false,
            loaded: status?.loaded ?? false,
            config: envelope,
            options: stripPluginEnvelope(envelope as never) as Record<
                string,
                unknown
            >,
        }
    })
    const installed = runtime.installer.enabled
        ? await runtime.installer.list()
        : []

    sendData(ctx.res, 200, {
        plugins,
        installed,
        installerEnabled: runtime.installer.enabled,
        configHash: (await ctx.deps.readConfig()).hash,
    })
}

export async function handlePluginConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = ctx.segments[2]
    const document = await ctx.deps.readConfig()

    if (id === undefined) throw new HttpError(404, 'unknown plugin')

    if (!isRecord(document.config.plugins[id])) {
        throw new HttpError(404, `unknown plugin: ${id}`)
    }

    const existing = asRecord(document.config.plugins[id]) as unknown as Record<
        string,
        unknown
    >
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

        for (const key of Object.keys(next)) {
            if (!ENVELOPE_KEYS.has(key)) delete next[key]
        }

        for (const [key, value] of Object.entries(body['options'])) {
            if (!ENVELOPE_KEYS.has(key)) next[key] = value
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
