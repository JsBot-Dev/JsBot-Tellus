import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthSession } from '../auth.js'
import { HttpError, isRecord, type URLSearchParamsLike } from '../http.js'
import type { WebUiDeps, WebUiRuntime } from '../types.js'

export interface ApiContext {
    deps: WebUiDeps
    req: IncomingMessage
    res: ServerResponse
    method: string
    pathname: string
    segments: string[]
    search: URLSearchParamsLike
    session: AuthSession
}

export function requireRuntime(deps: WebUiDeps): WebUiRuntime {
    const runtime = deps.getRuntime()

    if (!runtime) throw new HttpError(503, '运行时不可用，请稍后再试')

    return runtime
}

export function clampInt(
    value: string | null,
    fallback: number,
    min: number,
    max: number
): number {
    if (value === null) return fallback

    const parsed = Number.parseInt(value, 10)

    if (!Number.isFinite(parsed)) return fallback

    return Math.min(Math.max(parsed, min), max)
}

export function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}
