import {
    SqliteSessionStore,
    type SessionMessage,
    type SessionRole,
    type SessionState,
} from '../../storage/session.js'
import { HttpError, isRecord, readJsonBody, sendData } from '../http.js'
import {
    asRecord,
    clampInt,
    requireRuntime,
    type ApiContext,
} from './shared.js'

const MAX_SESSION_MESSAGES = 10_000

function parseSessionMessages(value: unknown): SessionMessage[] {
    if (!Array.isArray(value)) {
        throw new HttpError(400, 'messages must be an array')
    }

    if (value.length > MAX_SESSION_MESSAGES) {
        throw new HttpError(400, 'messages too long')
    }

    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw new HttpError(400, `invalid message at index ${index}`)
        }

        const role = item['role']
        const content = item['content']
        const at = item['at']

        if (role !== 'system' && role !== 'user' && role !== 'assistant') {
            throw new HttpError(400, `invalid message role at index ${index}`)
        }

        if (typeof content !== 'string') {
            throw new HttpError(
                400,
                `invalid message content at index ${index}`
            )
        }

        if (typeof at !== 'number' || !Number.isFinite(at)) {
            throw new HttpError(400, `invalid message time at index ${index}`)
        }

        return { role: role as SessionRole, content, at }
    })
}

function clearableString(
    value: unknown,
    fallback: string | undefined
): string | undefined {
    if (value === null) return undefined
    if (value === undefined) return fallback
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
    }

    return undefined
}

export async function handleSessionList(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const store = new SqliteSessionStore(runtime.database)
    const limit = clampInt(ctx.search.get('limit'), 50, 1, 200)
    const offset = clampInt(ctx.search.get('offset'), 0, 0, 10_000_000)
    const query = ctx.search.get('query')?.slice(0, 200) || undefined
    const items = await store.list({ limit, offset, query })
    const total = await store.count(query)

    sendData(ctx.res, 200, { items, total, limit, offset })
}

function sessionIdOf(ctx: ApiContext): string {
    const id = ctx.segments[2]

    if (!id) throw new HttpError(404, 'session not found')

    return id
}

function requireSessionStore(ctx: ApiContext): SqliteSessionStore {
    const runtime = requireRuntime(ctx.deps)

    return new SqliteSessionStore(runtime.database)
}

async function sessionDetail(ctx: ApiContext): Promise<SessionState> {
    const id = sessionIdOf(ctx)
    const state = await requireSessionStore(ctx).get(id)

    if (!state) throw new HttpError(404, 'session not found')

    return state
}

export async function handleSessionGet(ctx: ApiContext): Promise<void> {
    sendData(ctx.res, 200, await sessionDetail(ctx))
}

export async function handleSessionPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    await sessionDetail(ctx)

    const messages =
        body['messages'] === undefined
            ? undefined
            : parseSessionMessages(body['messages'])

    const baseline = await sessionDetail(ctx)
    const state: SessionState = {
        sessionId: sessionIdOf(ctx),
        provider: clearableString(body['provider'], baseline.provider),
        model: clearableString(body['model'], baseline.model),
        persona: clearableString(body['persona'], baseline.persona),
        messages: messages ?? baseline.messages,
        updatedAt: Date.now(),
    }

    await requireSessionStore(ctx).save(state)
    sendData(ctx.res, 200, state)
}

export async function handleSessionMessages(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const role = body['role']
    const content = body['content']

    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        throw new HttpError(400, 'invalid message role')
    }

    if (
        typeof content !== 'string' ||
        content.length === 0 ||
        content.length > 100_000
    ) {
        throw new HttpError(400, 'invalid message content')
    }

    const state = await sessionDetail(ctx)
    const message = { role: role as SessionRole, content, at: Date.now() }
    const next: SessionState = {
        ...state,
        messages: [...state.messages, message],
        updatedAt: Date.now(),
    }

    await requireSessionStore(ctx).save(next)
    sendData(ctx.res, 200, next)
}

export async function handleSessionSend(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = sessionIdOf(ctx)
    const message = body['message']
    const autoEscape = body['autoEscape']

    if (
        typeof message !== 'string' ||
        message.length === 0 ||
        message.length > 20_000
    ) {
        throw new HttpError(400, 'invalid message')
    }

    const runtime = requireRuntime(ctx.deps)

    await sessionDetail(ctx)

    const result = await runtime.api.send(
        id,
        message,
        typeof autoEscape === 'boolean' ? { autoEscape } : undefined
    )

    sendData(ctx.res, 200, { result: result ?? null })
}

export async function handleSessionDelete(ctx: ApiContext): Promise<void> {
    await requireSessionStore(ctx).clear(sessionIdOf(ctx))
    sendData(ctx.res, 200, { cleared: true })
}
