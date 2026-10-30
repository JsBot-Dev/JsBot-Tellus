import type { IncomingMessage, ServerResponse } from 'node:http'

export const CSRF_HEADER = 'x-requested-with'
export const CSRF_VALUE = 'jsbot-webui'

export interface CookieOptions {
    maxAgeSeconds?: number | undefined
    secure?: boolean | undefined
}

interface SendHeaders {
    [key: string]: string | undefined
}

export class HttpError extends Error {
    readonly status: number
    readonly details: unknown

    constructor(status: number, message: string, details?: unknown) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        this.details = details
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readJsonBody(
    req: IncomingMessage,
    limitBytes = 1_048_576
): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0

    for await (const chunk of req) {
        const buffer = chunk as Buffer

        size += buffer.length

        if (size > limitBytes) {
            throw new HttpError(413, 'request body too large')
        }

        chunks.push(buffer)
    }

    const text = Buffer.concat(chunks).toString('utf8').trim()

    if (text.length === 0) return {}

    try {
        return JSON.parse(text) as unknown
    } catch {
        throw new HttpError(400, 'request body must be valid JSON')
    }
}

export interface URLSearchParamsLike {
    get(name: string): string | null
}

export function sendData(
    res: ServerResponse,
    status: number,
    data: unknown,
    headers: SendHeaders = {}
): void {
    sendJson(res, status, { data }, headers)
}

export function sendJson(
    res: ServerResponse,
    status: number,
    data: unknown,
    headers: SendHeaders = {}
): void {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...headers,
    })
    res.end(safeStringify(data))
}

export function sendError(
    res: ServerResponse,
    status: number,
    message: string,
    details?: unknown,
    headers: SendHeaders = {}
): void {
    sendJson(
        res,
        status,
        { error: details === undefined ? { message } : { message, details } },
        headers
    )
}

function detailsOf(error: unknown): unknown {
    if (error instanceof HttpError) return error.details

    return undefined
}

export function respondWithError(res: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
        if (!res.headersSent) {
            sendError(res, error.status, error.message, detailsOf(error))
            return
        }
    } else if (!res.headersSent) {
        sendError(res, 500, 'internal server error')
        return
    }

    try {
        res.end()
    } catch {
        // Socket already destroyed.
    }
}

export function parseCookies(
    header: string | undefined
): Record<string, string> {
    const result: Record<string, string> = {}

    if (!header) return result

    for (const part of header.split(';')) {
        const separator = part.indexOf('=')

        if (separator <= 0) continue

        const key = part.slice(0, separator).trim()
        const value = part.slice(separator + 1).trim()

        if (key.length === 0) continue

        try {
            result[key] = decodeURIComponent(value)
        } catch {
            result[key] = value
        }
    }

    return result
}

export function serializeCookie(
    name: string,
    value: string | null,
    options: CookieOptions = {}
): string {
    const parts = [`${name}=`]

    if (value === null) {
        parts.push('; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    } else {
        parts.push(value)

        if (options.maxAgeSeconds !== undefined) {
            parts.push(
                `; Max-Age=${Math.max(Math.trunc(options.maxAgeSeconds), 0)}`
            )
        }
    }

    parts.push('; Path=/; HttpOnly; SameSite=Strict')

    if (options.secure === true) parts.push('; Secure')

    return parts.join('')
}

export function clearCookie(name: string): string {
    return serializeCookie(name, null)
}

function forwardedHost(
    req: IncomingMessage,
    trustProxy: boolean
): string | undefined {
    if (!trustProxy) return undefined

    const value = req.headers['x-forwarded-host']

    if (typeof value !== 'string' || value.length === 0) return undefined

    return value.split(',')[0]?.trim()
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
    if (trustProxy) {
        const forwarded = req.headers['x-forwarded-for']

        if (typeof forwarded === 'string' && forwarded.length > 0) {
            const first = forwarded.split(',')[0]?.trim()

            if (first) return first
        }
    }

    const address = req.socket.remoteAddress ?? 'unknown'

    return address.startsWith('::ffff:') ? address.slice(7) : address
}

export function isLoopbackHost(host: string): boolean {
    try {
        const url = new URL(`http://${host}`)

        return (
            url.hostname === '127.0.0.1' ||
            url.hostname === '[::1]' ||
            url.hostname === '::1' ||
            url.hostname === 'localhost'
        )
    } catch {
        return false
    }
}

export function sameOrigin(req: IncomingMessage, trustProxy: boolean): boolean {
    const origin = req.headers.origin

    if (typeof origin !== 'string') return true

    if (origin.length === 0 || origin === 'null') return false

    try {
        const originUrl = new URL(origin)
        const host = forwardedHost(req, trustProxy) ?? req.headers.host

        if (host === undefined) return false

        return originUrl.host.toLowerCase() === host.trim().toLowerCase()
    } catch {
        return false
    }
}

export function assertSameOrigin(
    req: IncomingMessage,
    trustProxy: boolean
): void {
    if (sameOrigin(req, trustProxy)) return

    throw new HttpError(403, 'cross-origin request rejected')
}

export function csrfHeader(req: IncomingMessage): string | undefined {
    const value = req.headers[CSRF_HEADER]

    return typeof value === 'string' ? value : undefined
}

export function assertCsrf(req: IncomingMessage): void {
    const value = csrfHeader(req)

    if (value?.toLowerCase() === CSRF_VALUE) return

    throw new HttpError(403, `missing ${CSRF_HEADER}: ${CSRF_VALUE} header`)
}

export function safeStringify(value: unknown): string {
    const seen = new WeakSet<object>()

    return JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return item.toString()

        if (typeof item !== 'object' || item === null) return item

        if (seen.has(item)) return '[Circular]'

        seen.add(item)

        return item
    })
}

const MIME_TYPES: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}

export function mimeType(filePath: string): string {
    const separator = filePath.lastIndexOf('.')

    if (separator < 0) return 'application/octet-stream'

    return (
        MIME_TYPES[filePath.slice(separator).toLowerCase()] ??
        'application/octet-stream'
    )
}

export function isImmutableAsset(pathname: string): boolean {
    return pathname.startsWith('/assets/')
}

export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`timeout after ${timeoutMs}ms`))
        }, timeoutMs)

        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}
