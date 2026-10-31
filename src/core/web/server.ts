import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http'
import { handleApiRoute } from './api.js'
import { AuthManager } from './auth.js'
import {
    assertCsrf,
    assertSameOrigin,
    respondWithError,
    sendData,
} from './http.js'
import { HttpError } from './http.js'
import { authenticate, handleAuth } from './server/auth.js'
import { buildCsp, cspForStaticDir } from './server/csp.js'
import { parseSearch, pathnameOf, segmentsOf } from './server/request.js'
import { applySecurityHeaders } from './server/security.js'
import {
    DEFAULT_MAX_SSE_CLIENTS,
    openSse,
    type SseConnection,
} from './server/sse.js'
import { FALLBACK_BODY, serveStatic } from './server/static.js'
import type { WebUiAddress, WebUiDeps, WebUiServerOptions } from './types.js'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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
        applySecurityHeaders(res)

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
                await serveStatic({
                    req,
                    res,
                    pathname,
                    staticDir: this.deps.paths.staticDir,
                    fallbackBody: this.fallbackBody,
                })

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
                await handleAuth({
                    req,
                    res,
                    action: segments[2],
                    auth: this.auth,
                    deps: this.deps,
                    bodyLimit: this.bodyLimit,
                })

                return
            }

            const session = authenticate(this.auth, req)

            if (session === null) {
                throw new HttpError(401, '未登录或会话已过期')
            }

            if (segments[1] === 'logs' && segments[2] === 'stream') {
                openSse({
                    req,
                    res,
                    subscribe: (listener) => this.deps.logs.subscribe(listener),
                    openedAt: Date.now(),
                    maxClients: this.maxSseClients,
                    connections: this.sse,
                })

                return
            }

            if (segments[1] === 'events' && segments[2] === 'stream') {
                openSse({
                    req,
                    res,
                    subscribe: (listener) =>
                        this.deps.events.subscribe(listener),
                    openedAt: Date.now(),
                    maxClients: this.maxSseClients,
                    connections: this.sse,
                })

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
}
