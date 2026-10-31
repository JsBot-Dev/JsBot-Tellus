import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthManager, type AuthSession } from '../auth.js'
import {
    clearCookie,
    clientIp,
    parseCookies,
    readJsonBody,
    sendData,
    sendError,
    serializeCookie,
} from '../http.js'
import { HttpError } from '../http.js'
import type { WebUiDeps } from '../types.js'

export const SESSION_COOKIE = 'jsbot_webui'

export function authenticate(
    auth: AuthManager,
    req: IncomingMessage
): AuthSession | null {
    const cookies = parseCookies(req.headers.cookie)

    return auth.authenticate(cookies[SESSION_COOKIE])
}

export function tokenOf(req: IncomingMessage): string | undefined {
    const cookies = parseCookies(req.headers.cookie)

    return cookies[SESSION_COOKIE]
}

export function isSecure(deps: WebUiDeps, req: IncomingMessage): boolean {
    if (!deps.getWebUiConfig().trustProxy) return false

    const proto = req.headers['x-forwarded-proto']

    return typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https'
}

export interface HandleAuthOptions {
    req: IncomingMessage
    res: ServerResponse
    action: string | undefined
    auth: AuthManager
    deps: WebUiDeps
    bodyLimit: number
}

export async function handleAuth(options: HandleAuthOptions): Promise<void> {
    const { req, res, action, auth, deps, bodyLimit } = options
    const method = req.method ?? 'GET'

    if (action === 'login' && method === 'POST') {
        const body = await readJsonBody(req, bodyLimit)
        const value =
            typeof body === 'object' && body !== null
                ? (body as Record<string, unknown>)
                : {}
        const ip = clientIp(req, deps.getWebUiConfig().trustProxy)
        const result = await auth.login(
            value['username'],
            value['password'],
            ip
        )

        if (!result.ok || !result.session) {
            const headers: Record<string, string | undefined> = {}

            if (result.retryAfterSeconds !== undefined) {
                headers['retry-after'] = String(result.retryAfterSeconds)
            }

            sendError(
                res,
                result.status,
                result.message ?? 'login failed',
                undefined,
                headers
            )

            return
        }

        res.setHeader(
            'set-cookie',
            serializeCookie(SESSION_COOKIE, result.session.token, {
                maxAgeSeconds: deps.getWebUiConfig().sessionTtlHours * 3600,
                secure: isSecure(deps, req),
            })
        )
        sendData(res, result.status, {
            username: result.session.username,
            expiresAt: result.session.expiresAt,
        })

        return
    }

    if (action === 'logout' && method === 'POST') {
        const session = authenticate(auth, req)

        auth.logout(tokenOf(req))
        deps.logger.info(`webui logout: ${session?.username ?? 'unknown'}`)
        res.setHeader('set-cookie', clearCookie(SESSION_COOKIE))
        sendData(res, 200, { ok: true })

        return
    }

    if (action === 'me' && method === 'GET') {
        const session = authenticate(auth, req)

        if (session === null) {
            throw new HttpError(401, '未登录或会话已过期')
        }

        sendData(res, 200, {
            username: session.username,
            expiresAt: session.expiresAt,
        })

        return
    }

    throw new HttpError(404, `not found: ${method} /api/auth/${action ?? ''}`)
}
