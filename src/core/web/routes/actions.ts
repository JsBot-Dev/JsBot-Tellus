import { HttpError, readJsonBody, sendData } from '../http.js'
import { asRecord, requireRuntime, type ApiContext } from './shared.js'

export async function handleActions(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const action = body['action']

    if (
        typeof action !== 'string' ||
        action.length === 0 ||
        action.length > 128
    ) {
        throw new HttpError(400, 'action is required')
    }

    const runtime = requireRuntime(ctx.deps)
    const params = body['params'] ?? undefined
    const result = await runtime.api.call(action as never, params as never)

    sendData(ctx.res, 200, { result: result ?? null })
}

export async function handleRuntimeCommand(ctx: ApiContext): Promise<void> {
    if (ctx.pathname.endsWith('/restart')) {
        sendData(ctx.res, 200, {
            ok: await ctx.deps.restart(),
        })

        return
    }

    if (ctx.pathname.endsWith('/pause')) {
        ctx.deps.pause()
        sendData(ctx.res, 200, { ok: true })

        return
    }

    if (ctx.pathname.endsWith('/resume')) {
        ctx.deps.resume()
        sendData(ctx.res, 200, { ok: true })
    }
}
