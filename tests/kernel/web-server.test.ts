import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
    appConfigSchema,
    type AppConfig,
    type WebUiConfig,
} from '../../src/core/config/schema.js'
import { createSilentLogger } from '../../src/core/logging/logger.js'
import { LogBuffer } from '../../src/core/logging/log-buffer.js'
import { EventFeed } from '../../src/core/web/event-feed.js'
import { WebUiServer } from '../../src/core/web/server.js'
import type { ConfigDocument, WebUiDeps } from '../../src/core/web/types.js'
import { createHash } from 'node:crypto'

interface TestEnv {
    server: WebUiServer
    logs: LogBuffer
    port: number
    config: {
        value: WebUiConfig
    }
    cookies: Record<string, string>
    fetch(
        path: string,
        init?: {
            method?: string
            body?: string
            origin?: string
            csrf?: boolean
        }
    ): Promise<{
        status: number
        headers: Record<string, string>
        text: string
    }>
    shutdown(): Promise<void>
}

let directories: string[] = []

function webUiConfig(
    port: number,
    overrides: Partial<WebUiConfig> = {}
): WebUiConfig {
    return {
        enabled: true,
        host: '127.0.0.1',
        port,
        username: 'admin',
        password: 'super-secret-pass',
        sessionTtlHours: 12,
        trustProxy: false,
        ...overrides,
    }
}

async function createEnv(webui: WebUiConfig): Promise<TestEnv> {
    const directory = await mkdtemp(join(tmpdir(), 'jsbot-web-server-'))

    directories.push(directory)

    const configPath = join(directory, 'bot.config.json')
    // The config file must satisfy the schema (port >= 1); the server itself
    // listens on port 0 so the OS assigns a free port for the test.
    const appConfig: AppConfig = appConfigSchema.parse({
        url: 'ws://127.0.0.1:39999/',
        webui: { ...webui, port: webui.port === 0 ? 8787 : webui.port },
        plugins: {},
    })

    await writeFile(configPath, JSON.stringify(appConfig, null, 4))

    const logs = new LogBuffer()
    const events = new EventFeed()

    let address: { host: string; port: number } | null = null

    const config: { value: WebUiConfig } = { value: webui }
    const cookies: Record<string, string> = {}

    const deps: WebUiDeps = {
        logger: createSilentLogger('test'),
        paths: {
            configPath,
            dataDir: directory,
            pluginDir: directory,
            staticDir: null,
        },
        version: 'test',
        logs,
        events,
        getWebUiConfig: () => config.value,
        readConfig: async () => {
            const raw = await readFileOf(configPath)

            return {
                path: configPath,
                raw,
                hash: createHash('sha256').update(raw).digest('hex'),
                config: appConfigSchema.parse(JSON.parse(raw)),
            } satisfies ConfigDocument
        },
        validateConfig: async (value) => {
            const parsed = appConfigSchema.safeParse(value)

            return parsed.success
                ? { ok: true, issues: [] }
                : {
                      ok: false,
                      issues: [{ path: '', message: 'invalid' }],
                  }
        },
        applyConfig: async () => ({ ok: true }),
        restart: async () => true,
        requestRestart: () => {},
        pause: () => {},
        resume: () => {},
        getListening: () => address,
        invalidateSessions: () => {},
        runExclusive: (task) => task(),
        getRuntime: () => null,
        isRestarting: () => false,
        getStartupError: () => 'boom',
        getRequiresProcessRestart: () => false,
    }

    const server = new WebUiServer({ config: webui, deps })
    const listened = await server.start({ ...webui, port: 0 })

    address = listened

    const port = listened?.port ?? webui.port

    const env: TestEnv = {
        server,
        logs,
        port,
        config,
        cookies,
        async fetch(path, init = {}) {
            const method = init.method ?? 'GET'
            const headers: Record<string, string> = {
                'content-type': 'application/json',
            }

            if (init.csrf !== false && method !== 'GET') {
                headers['x-requested-with'] = 'jsbot-webui'
            }

            if (init.origin) headers['origin'] = init.origin

            if (Object.keys(cookies).length > 0) {
                headers['cookie'] = Object.entries(cookies)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('; ')
            }

            const response = await fetch(`http://127.0.0.1:${port}${path}`, {
                method,
                headers,
                ...(init.body !== undefined ? { body: init.body } : {}),
                redirect: 'manual',
            })

            const headerBag: Record<string, string> = {}

            response.headers.forEach((value, key) => {
                headerBag[key] = value
            })

            const setCookie = response.headers.get('set-cookie')
            const cookiePair =
                setCookie !== null ? setCookie.split(';')[0] : null

            if (
                cookiePair !== null &&
                cookiePair !== undefined &&
                env !== undefined
            ) {
                const [name, ...rest] = cookiePair.split('=')

                if (rest.length > 0 && name !== undefined) {
                    const value = rest.join('=')

                    if (value.length > 0) {
                        cookies[name.trim()] = value
                    } else {
                        delete cookies[name.trim()]
                    }
                }
            }

            return {
                status: response.status,
                headers: headerBag,
                text: await response.text(),
            }
        },
        async shutdown() {
            await server.stop()

            await rm(directory, { recursive: true, force: true })

            directories = directories.filter((item) => item !== directory)
        },
    }

    return env
}

async function readFileOf(path: string): Promise<string> {
    const { readFile } = await import('node:fs/promises')

    return readFile(path, 'utf8')
}

beforeAll(() => {
    void directories
})

afterAll(async () => {
    for (const directory of directories) {
        await rm(directory, { recursive: true, force: true })
    }
})

describe('WebUiServer', () => {
    it('answers /api/health without auth', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            const response = await env.fetch('/api/health')

            expect(response.status).toBe(200)
            expect(response.text).toBe('{"data":{"ok":true}}')
        } finally {
            await env.shutdown()
        }
    })

    it('rejects unauthenticated api access', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            const response = await env.fetch('/api/status')

            expect(response.status).toBe(401)
        } finally {
            await env.shutdown()
        }
    })

    it('rejects wrong credentials', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            const response = await env.fetch('/api/auth/login', {
                method: 'POST',
                body: '{"username":"admin","password":"nope"}',
            })

            expect(response.status).toBe(401)
        } finally {
            await env.shutdown()
        }
    })

    it('logs in, serves status and logs', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            env.logs.push({
                level: 'info',
                scope: 'app',
                message: 'hello',
                args: [],
                time: new Date(0),
            })

            const login = await env.fetch('/api/auth/login', {
                method: 'POST',
                body: '{"username":"admin","password":"super-secret-pass"}',
            })

            expect(login.status).toBe(200)
            expect(Object.keys(env.cookies).length).toBe(1)

            const me = await env.fetch('/api/auth/me')

            expect(me.status).toBe(200)
            expect(me.text).toContain('admin')

            const status = await env.fetch('/api/status')
            const payload = JSON.parse(status.text) as {
                data: { startupError: string }
            }

            expect(status.status).toBe(200)
            expect(payload.data.startupError).toBe('boom')

            const logList = await env.fetch('/api/logs?limit=1')

            expect(logList.text).toContain('hello')
        } finally {
            await env.shutdown()
        }
    })

    it('requires the csrf header for writes', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            await env.fetch('/api/auth/login', {
                method: 'POST',
                body: '{"username":"admin","password":"super-secret-pass"}',
            })

            const withoutCsrf = await env.fetch('/api/runtime/pause', {
                method: 'POST',
                body: '{}',
                csrf: false,
                origin: `http://127.0.0.1:${env.port}`,
            })

            expect(withoutCsrf.status).toBe(403)

            const crossOrigin = await env.fetch('/api/runtime/pause', {
                method: 'POST',
                body: '{}',
                origin: 'http://evil.example:8080',
            })

            expect(crossOrigin.status).toBe(403)

            const ok = await env.fetch('/api/runtime/pause', {
                method: 'POST',
                body: '{}',
                origin: `http://127.0.0.1:${env.port}`,
            })

            expect(ok.status).toBe(200)
        } finally {
            await env.shutdown()
        }
    })

    it('serves an explanatory fallback when static assets are missing', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            const response = await env.fetch('/')

            expect(response.status).toBe(503)
            expect(response.text).toContain('WebUI 前端未构建')
        } finally {
            await env.shutdown()
        }
    })

    it('rejects oversized request bodies with 413', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            await env.fetch('/api/auth/login', {
                method: 'POST',
                body: '{"username":"admin","password":"super-secret-pass"}',
            })

            const response = await env.fetch('/api/actions', {
                method: 'POST',
                body: JSON.stringify({ action: 'x'.repeat(1_100_000) }),
            })

            expect(response.status).toBe(413)
        } finally {
            await env.shutdown()
        }
    })

    it('opens an SSE stream for logs', async () => {
        const env = await createEnv(webUiConfig(0))

        try {
            await env.fetch('/api/auth/login', {
                method: 'POST',
                body: '{"username":"admin","password":"super-secret-pass"}',
            })

            const controller = new AbortController()
            const response = await fetch(
                `http://127.0.0.1:${env.port}/api/logs/stream`,
                {
                    headers: {
                        cookie: Object.entries(env.cookies)
                            .map(([key, value]) => `${key}=${value}`)
                            .join('; '),
                    },
                    signal: controller.signal,
                }
            )

            expect(response.headers.get('content-type')).toContain(
                'text/event-stream'
            )

            const reader = response.body?.getReader()
            const first = await reader?.read()

            expect(new TextDecoder().decode(first?.value)).toContain(':ok')

            env.logs.push({
                level: 'warn',
                scope: 'app',
                message: 'streamed',
                args: [],
                time: new Date(0),
            })

            const second = await reader?.read()
            const chunk = new TextDecoder().decode(second?.value)

            expect(chunk).toContain('streamed')

            controller.abort()
            await env.shutdown().catch(() => {})

            directories = []
        } finally {
            // shutdown handled above to close sockets.
            await handleStragglers()
        }
    })
})

async function handleStragglers(): Promise<void> {
    for (const directory of directories) {
        await rm(directory, { recursive: true, force: true })
    }

    directories = []
}
