import {
    createServer,
    type IncomingMessage,
    type RequestListener,
    type Server,
    type ServerResponse,
} from 'node:http'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { AuthManager, type AuthSession } from './auth.js'
import { handleApiRoute } from './api.js'
import {
    assertCsrf,
    assertSameOrigin,
    clearCookie,
    clientIp,
    isImmutableAsset,
    mimeType,
    parseCookies,
    readJsonBody,
    respondWithError,
    safeStringify,
    sendError,
    sendData,
    serializeCookie,
    withTimeout,
    type URLSearchParamsLike,
} from './http.js'
import { HttpError } from './http.js'
import type { WebUiAddress, WebUiDeps, WebUiServerOptions } from './types.js'

const SESSION_COOKIE = 'jsbot_webui'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SECURITY_HEADERS: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
}

/**
 * CSP for the WebUI. webui/index.html ships a single authorized inline
 * script (the no-flash appearance bootstrap for the first paint); its exact
 * hash is derived from the built index.html on disk so editing the bootstrap
 * only needs a rebuild, never a source edit. Every other inline script
 * stays blocked.
 */
function buildCsp(scriptSrc: string): string {
    return `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
}

/** Extracts the bootstrap script's sha256 from a built index.html. */
function cspForStaticDir(staticDir: string): string | null {
    try {
        const html = readFileSync(join(staticDir, 'index.html'), 'utf8')
        const match = /<script>([\s\S]*?)<\/script>/.exec(html)
        const bootstrap = match?.[1]

        if (bootstrap === undefined) return null

        const hash = createHash('sha256')
            .update(bootstrap, 'utf8')
            .digest('base64')

        return buildCsp(`'self' 'sha256-${hash}'`)
    } catch {
        return null
    }
}

const SSE_HEARTBEAT_MS = 15_000
const DEFAULT_MAX_SSE_CLIENTS = 20
const SSE_TIMEOUT_MS = 60_000

interface SseConnection {
    res: ServerResponse
    close(): void
}

interface FallbackPageOptions {
    listening: string
}

const FALLBACK_BODY = (options: FallbackPageOptions): string => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>JsBot WebUI</title>
<style>body{font-family:system-ui,sans-serif;max-width:36em;margin:4rem auto;padding:0 1rem;color:#333}</style>
</head><body>
<h1>WebUI 前端未构建</h1>
<p>管理 API 正常运行，但静态资源缺失。请在项目根目录执行：</p>
<pre><code>npm run build:webui</code></pre>
<p>然后重启进程，访问 <code>${options.listening}</code>。</p>
<p>API 仍可通过 <code>/api/health</code>、登录和各接口访问。</p>
</body></html>
`

function errorPayload(error: unknown): {
    status: number
    message: string
    details: unknown
} {
    if (error instanceof HttpError) {
        return {
            status: error.status,
            message: error.message,
            details: error.details,
        }
    }

    return {
        status: 500,
        message: error instanceof Error ? error.message : 'internal error',
        details: undefined,
    }
}

function parseSearch(req: IncomingMessage): URLSearchParamsLike {
    const index = (req.url ?? '').indexOf('?')
    const query = index >= 0 ? (req.url ?? '').slice(index + 1) : ''

    return new URLSearchParams(query)
}

function segmentsOf(pathname: string): string[] {
    return pathname
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => {
            try {
                return decodeURIComponent(segment)
            } catch {
                return segment
            }
        })
}

function pathnameOf(req: IncomingMessage): string {
    const url = req.url ?? '/'
    const index = url.indexOf('?')
    const raw = index >= 0 ? url.slice(0, index) : url

    if (raw.includes('%')) {
        try {
            return decodeURIComponent(raw)
        } catch {
            return raw
        }
    }

    return raw
}

export class WebUiServer {
    private readonly deps: WebUiDeps
    private readonly maxSseClients: number
    private readonly bodyLimit: number
    private readonly loginMaxFailures: number | undefined
    private readonly loginWindowMs: number | undefined
    private readonly auth: AuthManager
    private readonly sse = new Set<SseConnection>()
    private readonly fallbackBody: string

    private httpServer: Server | null = null
    private listening: WebUiAddress | null = null
    private cspCache: string | null = null

    constructor(options: WebUiServerOptions) {
        const { config, deps } = options

        this.deps = deps
        this.maxSseClients = options.maxSseClients ?? DEFAULT_MAX_SSE_CLIENTS
        this.bodyLimit = options.bodyLimitBytes ?? 1_048_576
        this.loginMaxFailures = options.loginMaxFailures
        this.loginWindowMs = options.loginWindowMs
        this.fallbackBody = FALLBACK_BODY({
            listening: `http://${config.host}:${config.port}`,
        })
        this.auth = new AuthManager({
            getConfig: () => deps.getWebUiConfig(),
            ...(options.loginMaxFailures !== undefined
                ? { maxFailures: options.loginMaxFailures }
                : {}),
            ...(options.loginWindowMs !== undefined
                ? { windowMs: options.loginWindowMs }
                : {}),
        })
    }

    get address(): WebUiAddress | null {
        return this.listening
    }

    async start(
        config: WebUiServerOptions['config']
    ): Promise<WebUiAddress | null> {
        if (this.httpServer !== null) return this.listening

        const server = createServer(this.handleRequest.bind(this))

        try {
            await new Promise<void>((resolvePromise, reject) => {
                server.once('error', reject)
                server.listen(config.port, config.host, () => {
                    server.off('error', reject)
                    resolvePromise()
                })
            })

            const address = server.address()

            if (address === null) {
                this.listening = {
                    host: config.host,
                    port: config.port,
                }
            } else if (typeof address === 'string') {
                this.listening = { host: address, port: config.port }
            } else {
                this.listening = {
                    host: config.host,
                    port: address.port,
                }
            }

            this.httpServer = server
            this.deps.logger.info(
                `webui listening on http://${config.host}:${this.listening.port}`
            )

            return this.listening
        } catch (error) {
            this.deps.logger.error('webui listen failed', error)
            server.close()

            return null
        }
    }

    get requiresRestart(): boolean {
        return this.httpServer !== null
    }

    async stop(): Promise<void> {
        for (const connection of [...this.sse]) connection.close()

        this.sse.clear()
        this.auth.invalidateAll()

        const server = this.httpServer

        if (server === null) return

        this.httpServer = null
        this.listening = null

        await new Promise<void>((resolvePromise) => {
            server.close(() => resolvePromise())
        })
    }

    invalidateSessions(): void {
        this.auth.invalidateAll()
    }

    private applySecurityHeaders(res: ServerResponse): void {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
            res.setHeader(key, value)
        }

        if (this.cspCache === null) {
            // Derived once per server instance from the built index.html.
            const staticDir = this.deps.paths.staticDir

            this.cspCache =
                staticDir !== null
                    ? (cspForStaticDir(staticDir) ?? buildCsp("'self'"))
                    : buildCsp("'self'")
        }

        res.setHeader('content-security-policy', this.cspCache)
    }

    private async handleRequest(
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> {
        this.applySecurityHeaders(res)

        try {
            const pathname = pathnameOf(req)

            if (pathname === '/api/health') {
                res.setHeader('cache-control', 'no-store')
                sendData(res, 200, { ok: true })

                return
            }

            if (!pathname.startsWith('/api/') && pathname !== '/api') {
                await this.serveStatic(req, res, pathname)

                return
            }

            if (!WRITE_METHODS.has(req.method ?? 'GET')) {
                assertSameOrigin(req, this.deps.getWebUiConfig().trustProxy)
            } else {
                assertSameOrigin(req, this.deps.getWebUiConfig().trustProxy)
                assertCsrf(req)
            }

            const segments = segmentsOf(pathname)

            if (segments[1] === 'auth') {
                await this.handleAuth(req, res, segments[2])

                return
            }

            const session = this.authenticate(req)

            if (session === null) {
                throw new HttpError(401, '未登录或会话已过期')
            }

            if (segments[1] === 'logs' && segments[2] === 'stream') {
                this.openSse(
                    req,
                    res,
                    (listener) => this.deps.logs.subscribe(listener),
                    Date.now()
                )

                return
            }

            if (segments[1] === 'events' && segments[2] === 'stream') {
                this.openSse(
                    req,
                    res,
                    (listener) => this.deps.events.subscribe(listener),
                    Date.now()
                )

                return
            }

            const handled = await handleApiRoute({
                deps: this.deps,
                req,
                res,
                method: req.method ?? 'GET',
                pathname,
                segments,
                search: parseSearch(req),
                session,
            })

            if (handled) return

            throw new HttpError(404, `not found: ${req.method} ${pathname}`)
        } catch (error) {
            respondWithError(res, error)
        }
    }

    private authenticate(req: IncomingMessage): AuthSession | null {
        const cookies = parseCookies(req.headers.cookie)

        return this.auth.authenticate(cookies[SESSION_COOKIE])
    }

    private async handleAuth(
        req: IncomingMessage,
        res: ServerResponse,
        action: string | undefined
    ): Promise<void> {
        const method = req.method ?? 'GET'

        if (action === 'login' && method === 'POST') {
            const body = await readJsonBody(req, this.bodyLimit)
            const value =
                typeof body === 'object' && body !== null
                    ? (body as Record<string, unknown>)
                    : {}
            const ip = clientIp(req, this.deps.getWebUiConfig().trustProxy)
            const result = await this.auth.login(
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
                    maxAgeSeconds:
                        this.deps.getWebUiConfig().sessionTtlHours * 3600,
                    secure: this.isSecure(req),
                })
            )
            sendData(res, result.status, {
                username: result.session.username,
                expiresAt: result.session.expiresAt,
            })

            return
        }

        if (action === 'logout' && method === 'POST') {
            const session = this.authenticate(req)

            this.auth.logout(this.tokenOf(req))
            this.deps.logger.info(
                `webui logout: ${session?.username ?? 'unknown'}`
            )
            res.setHeader('set-cookie', clearCookie(SESSION_COOKIE))
            sendData(res, 200, { ok: true })

            return
        }

        if (action === 'me' && method === 'GET') {
            const session = this.authenticate(req)

            if (session === null) {
                throw new HttpError(401, '未登录或会话已过期')
            }

            sendData(res, 200, {
                username: session.username,
                expiresAt: session.expiresAt,
            })

            return
        }

        throw new HttpError(
            404,
            `not found: ${method} /api/auth/${action ?? ''}`
        )
    }

    private tokenOf(req: IncomingMessage): string | undefined {
        const cookies = parseCookies(req.headers.cookie)

        return cookies[SESSION_COOKIE]
    }

    private isSecure(req: IncomingMessage): boolean {
        if (!this.deps.getWebUiConfig().trustProxy) return false

        const proto = req.headers['x-forwarded-proto']

        return (
            typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https'
        )
    }

    private openSse(
        req: IncomingMessage,
        res: ServerResponse,
        subscribe: (listener: (entry: unknown) => void) => () => void,
        openedAt: number
    ): void {
        if (this.sse.size >= this.maxSseClients) {
            throw new HttpError(503, '实时连接数量已达上限')
        }

        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store, no-transform',
            connection: 'keep-alive',
        })
        res.write(':ok\n\n')

        const connection: SseConnection = {
            res,
            close: () => {
                unsubscribe()
                clearInterval(heartbeat)
                this.sse.delete(connection)

                try {
                    res.end()
                } catch {
                    // Already closed.
                }
            },
        }

        let closing = false

        const unsubscribe = subscribe((entry) => {
            if (closing) return

            res.write(`data: ${safeStringify(entry)}\n\n`)
        })

        const heartbeat = setInterval(() => {
            res.write(`:keepalive ${Date.now() - openedAt}\n\n`)
        }, SSE_HEARTBEAT_MS)

        req.on('close', () => {
            if (closing) return

            closing = true

            unsubscribe()
            clearInterval(heartbeat)
            this.sse.delete(connection)
        })

        this.sse.add(connection)
    }

    private async serveStatic(
        req: IncomingMessage,
        res: ServerResponse,
        pathname: string
    ): Promise<void> {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            throw new HttpError(405, `method not allowed: ${req.method}`)
        }

        const staticDir = this.deps.paths.staticDir

        if (staticDir === null) {
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.writeHead(503)
            res.end(this.fallbackBody)

            return
        }

        const cleaned = pathname.replace(/\/+$/, '') || '/'
        let filePath =
            cleaned === '/'
                ? join(staticDir, 'index.html')
                : resolve(staticDir, `.${cleaned}`)

        if (!filePath.startsWith(staticDir + sep) && filePath !== staticDir) {
            throw new HttpError(403, 'forbidden')
        }

        let fileStat = await this.statOrNull(filePath)

        if (fileStat?.isDirectory()) {
            filePath = join(filePath, 'index.html')
            fileStat = await this.statOrNull(filePath)
        }

        if (fileStat === null) {
            // SPA fallback: only routes without a file extension.
            if (extname(cleaned) === '') {
                filePath = join(staticDir, 'index.html')
                fileStat = await this.statOrNull(filePath)
            }

            if (fileStat === null) throw new HttpError(404, 'not found')
        }

        const cacheControl = isImmutableAsset(cleaned)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache'

        res.setHeader('content-type', mimeType(filePath))
        res.setHeader('cache-control', cacheControl)
        res.setHeader('content-length', String(fileStat.size))
        res.writeHead(200)

        if (req.method === 'HEAD') {
            res.end()

            return
        }

        const stream = createReadStream(filePath)

        stream.on('error', () => {
            try {
                res.end()
            } catch {
                // Already closed.
            }
        })
        stream.pipe(res)
    }

    private async statOrNull(
        filePath: string
    ): Promise<Awaited<ReturnType<typeof stat>> | null> {
        try {
            return await withTimeout(stat(filePath), 1_000)
        } catch {
            return null
        }
    }
}
