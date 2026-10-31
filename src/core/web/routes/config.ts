import { maskConfig } from '../config-store.js'
import { readJsonBody, sendData } from '../http.js'
import { asRecord, type ApiContext } from './shared.js'

export async function handleConfigGet(ctx: ApiContext): Promise<void> {
    const document = await ctx.deps.readConfig()
    const masked = maskConfig(document.config)

    sendData(ctx.res, 200, {
        config: masked.config,
        meta: {
            path: document.path,
            hash: document.hash,
            accessTokenSet: masked.accessTokenSet,
            webuiPasswordSet: masked.webuiPasswordSet,
        },
    })
}

export async function handleConfigValidate(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const result = await ctx.deps.validateConfig(body['config'])

    sendData(ctx.res, 200, {
        ok: result.ok,
        issues: result.issues,
    })
}

export async function handleConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const baseHash = body['baseHash']

    sendData(
        ctx.res,
        200,
        await ctx.deps.applyConfig(
            body['config'],
            typeof baseHash === 'string' ? baseHash : undefined
        )
    )
}
