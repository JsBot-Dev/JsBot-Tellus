import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
    appConfigSchema,
    type AppConfig,
    type WebUiConfig,
} from '../src/core/config/schema.js'
import { createSilentLogger } from '../src/core/logging/logger.js'
import { LogBuffer } from '../src/core/logging/log-buffer.js'
import { EventFeed } from '../src/core/web/event-feed.js'
import { WebUiServer } from '../src/core/web/server.js'
import type { ConfigDocument, WebUiDeps } from '../src/core/web/types.js'

/**
 * The built index.html ships exactly one inline script — the no-flash
 * appearance bootstrap. The server derives its sha256 from the built file
 * and authorizes it in the CSP. These tests pin that coupling: future edits
 * to webui/index.html fail here until `npm run build` refreshes dist.
 */
function makeWebUi(port: number): WebUiConfig {
    return {
        enabled: true,
        host: '127.0.0.1',
        port,
        username: 'admin',
        password: 'super-secret-pass',
        sessionTtlHours: 12,
        trustProxy: false,
    }
}

describe('WebUiServer CSP authorizes the built appearance bootstrap', () => {
    const directories: string[] = []

    afterAll(async () => {
        await Promise.all(
            directories.map((directory) =>
                rm(directory, { recursive: true, force: true })
            )
        )
    })

    it('serves index.html with a CSP hash matching the bootstrap', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'jsbot-webui-csp-'))

        directories.push(directory)

        const configPath = join(directory, 'bot.config.json')
        const webui = makeWebUi(0)
        const appConfig: AppConfig = appConfigSchema.parse({
            url: 'ws://127.0.0.1:39999/',
            // The config file must satisfy the schema (port >= 1); the
            // server itself listens on port 0 so the OS assigns a free port.
            webui: { ...webui, port: webui.port === 0 ? 8787 : webui.port },
            plugins: {},
        })

        await writeFile(configPath, JSON.stringify(appConfig, null, 4))

        let address: { host: string; port: number } | null = null
        const config: { value: WebUiConfig } = { value: webui }

        const deps: WebUiDeps = {
            logger: createSilentLogger('test'),
            paths: {
                configPath,
                dataDir: directory,
                pluginDir: directory,
                staticDir: 'dist/webui',
            },
            version: 'test',
            logs: new LogBuffer(),
            events: new EventFeed(),
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

        try {
            const port = listened?.port ?? 0

            expect(port).toBeGreaterThan(0)

            const page = await fetch(`http://127.0.0.1:${port}/`)
            const body = await page.text()
            const csp = page.headers.get('content-security-policy') ?? ''

            expect(page.status).toBe(200)
            expect(body).toContain('jsbot-webui-appearance')

            const html = readFileSync('dist/webui/index.html', 'utf8')
            const match = /<script>([\s\S]*?)<\/script>/.exec(html)
            const bootstrap = match?.[1]
            const hash =
                bootstrap === undefined
                    ? null
                    : createHash('sha256')
                          .update(bootstrap, 'utf8')
                          .digest('base64')

            expect(hash).not.toBeNull()
            expect(csp).toContain(`'sha256-${hash}'`)
        } finally {
            await server.stop()
        }
    })

    it('keeps every other inline script blocked', () => {
        const html = readFileSync('dist/webui/index.html', 'utf8')
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]

        expect(scripts).toHaveLength(1)
    })
})

async function readFileOf(path: string): Promise<string> {
    const { readFile } = await import('node:fs/promises')

    return readFile(path, 'utf8')
}
