import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
    appConfigSchema,
    type AppConfig,
} from '../../src/core/config/schema.js'
import {
    definePlugin,
    type AnyPluginDefinition,
} from '../../src/core/plugin/types.js'
import {
    ConfigStore,
    ConfigStoreError,
    maskConfig,
    mergeSecrets,
} from '../../src/core/web/config-store.js'

function baseConfig(): AppConfig {
    return appConfigSchema.parse({
        url: 'ws://127.0.0.1:39999/',
        webui: {
            enabled: true,
            host: '127.0.0.1',
            port: 18787,
            username: 'admin',
            password: 'original-pass',
            sessionTtlHours: 12,
            trustProxy: false,
        },
    })
}

function demoPlugin(): AnyPluginDefinition {
    return definePlugin({
        manifest: {
            id: 'demo',
            version: '1.0.0',
            defaultEnabled: true,
            configSchema: z
                .object({
                    token: z.string(),
                    count: z.number().int().default(1),
                })
                .strict(),
        },
        setup: () => {},
    })
}

interface TestHarness {
    store: ConfigStore
    configPath: string
    pluginConfigDir: string
    warnings: string[]
    read(): Promise<AppConfig>
    write(value: AppConfig): Promise<void>
    restartCalls: number
    setRestartOutcome(ok: boolean): void
}

let directories: string[] = []

async function harness(
    plugins: AnyPluginDefinition[] = [demoPlugin()]
): Promise<TestHarness> {
    const directory = await mkdtemp(join(tmpdir(), 'jsbot-config-store-'))

    directories.push(directory)

    const configPath = join(directory, 'bot.config.jsonc')
    const pluginConfigDir = join(directory, 'data', 'config', 'plugin')
    const state = { restartOk: true, restartCalls: 0 }
    const warnings: string[] = []

    const store = new ConfigStore({
        configPath,
        pluginConfigDir,
        getPlugins: () => plugins,
        restart: async () => {
            state.restartCalls += 1

            return state.restartOk
        },
        onWarning: (message) => warnings.push(message),
    })

    const harness: TestHarness = {
        store,
        configPath,
        pluginConfigDir,
        warnings,
        restartCalls: 0,
        async read(): Promise<AppConfig> {
            return appConfigSchema.parse(
                JSON.parse(await readFile(configPath, 'utf8'))
            )
        },
        async write(value: AppConfig): Promise<void> {
            await writeFile(configPath, JSON.stringify(value, null, 4))
        },
        setRestartOutcome(ok: boolean) {
            state.restartOk = ok
        },
    }

    await harness.write(baseConfig())

    return {
        ...harness,
        get restartCalls() {
            return state.restartCalls
        },
    }
}

beforeEach(() => {
    directories = []
})

afterAll(async () => {
    for (const directory of directories) {
        await rm(directory, { recursive: true, force: true })
    }
})

describe('ConfigStore.read', () => {
    it('returns raw, hash and parsed config', async () => {
        const env = await harness()
        const document = await env.store.read()

        expect(document.path).toBe(configPathOf(env))
        expect(document.hash).toMatch(/[0-9a-f]{64}/)
        expect(document.config.webui.enabled).toBe(true)
        expect(document.raw).toContain('"webui"')
    })

    it('reads JSONC with comments and trailing commas', async () => {
        const env = await harness()

        await writeFile(
            env.configPath,
            [
                '// main config',
                '{',
                '    "url": "ws://127.0.0.1:3002/",',
                '    "roles": { "superadmin": [], "admin": [] },',
                '    "webui": { "enabled": false },',
                '}',
            ].join('\n'),
            'utf8'
        )

        const document = await env.store.read()

        expect(document.config.url).toBe('ws://127.0.0.1:3002/')
    })

    it('ignores the legacy plugins field with a warning', async () => {
        const env = await harness()

        await env.write({
            ...baseConfig(),
            plugins: {},
        } as unknown as AppConfig)

        const document = await env.store.read()

        expect(document.config).not.toHaveProperty('plugins')
        expect(env.warnings).toHaveLength(1)
        expect(env.warnings[0]).toContain('已忽略')
    })
})

function configPathOf(env: TestHarness): string {
    return env.configPath
}

describe('ConfigStore.validate', () => {
    it('passes for a valid document', async () => {
        const env = await harness()
        const result = await env.store.validate({ ...baseConfig() })

        expect(result.ok).toBe(true)
        expect(result.issues).toEqual([])
    })

    it('reports schema issues', async () => {
        const env = await harness()
        const result = await env.store.validate({
            url: 'http://not-ws.example/',
            webui: { enabled: true, username: 'a', password: 'tiny' },
        })

        expect(result.ok).toBe(false)
        expect(result.issues.length).toBeGreaterThan(0)
    })

    it('ignores the legacy plugins field', async () => {
        const env = await harness()
        const result = await env.store.validate({
            ...baseConfig(),
            plugins: {},
        })

        expect(result.ok).toBe(true)
        expect(result.config).not.toHaveProperty('plugins')
        expect(env.warnings).toHaveLength(1)
    })

    it('unreported secrets are inherited from the current file', async () => {
        const env = await harness()
        const current = await env.store.read()

        const merged = mergeSecrets(current.config, {
            url: 'ws://127.0.0.1:39999/',
            webui: {
                enabled: true,
                host: '127.0.0.1',
                port: 18787,
                username: 'admin',
                sessionTtlHours: 12,
                trustProxy: false,
            },
        })

        expect(
            (merged as { webui: { password?: string } }).webui.password
        ).toBe('original-pass')
    })
})

describe('ConfigStore.apply', () => {
    it('writes a new config, restarts and returns the new hash', async () => {
        const env = await harness()
        const document = await env.store.read()

        const next = {
            ...document.config,
            url: 'ws://127.0.0.1:40001/',
        }

        const result = await env.store.apply(next, document.hash)

        expect(result.ok).toBe(true)
        expect(result.hash).toMatch(/[0-9a-f]{64}/)
        expect(env.restartCalls).toBe(1)
        expect((await env.read()).url).toBe('ws://127.0.0.1:40001/')
    })

    it('rejects a stale base hash with 409', async () => {
        const env = await harness()
        const document = await env.store.read()
        const next = { ...document.config, url: 'ws://127.0.0.1:40002/' }

        let error: unknown

        try {
            await env.store.apply(next, '0'.repeat(64))
        } catch (caught) {
            error = caught
        }

        expect(error).toBeInstanceOf(ConfigStoreError)

        const storeError = error as ConfigStoreError

        expect(storeError.status).toBe(409)
        expect(await env.read()).toBeTypeOf('object')
    })

    it('rejects an invalid document and rewrites nothing', async () => {
        const env = await harness()
        const document = await env.store.read()

        let error: unknown

        try {
            await env.store.apply({ bogus: true }, document.hash)
        } catch (caught) {
            error = caught
        }

        expect(error).toBeInstanceOf(ConfigStoreError)

        const storeError = error as ConfigStoreError

        expect(storeError.status).toBe(400)
        expect(storeError.issues.length).toBeGreaterThan(0)

        // Original file untouched.
        expect(await env.read()).toEqual(document.config)
    })

    it('drops the legacy plugins field when saving', async () => {
        const env = await harness()
        const document = await env.store.read()

        const result = await env.store.apply(
            { ...document.config, plugins: {} },
            document.hash
        )

        expect(result.ok).toBe(true)
        expect(env.restartCalls).toBe(1)
        expect(env.warnings).toHaveLength(1)

        const written = JSON.parse(
            await readFile(env.configPath, 'utf8')
        ) as Record<string, unknown>

        expect(written).not.toHaveProperty('plugins')
    })

    it('restores the previous config when restart fails', async () => {
        const env = await harness()

        env.setRestartOutcome(false)

        const document = await env.store.read()
        const next = { ...document.config, url: 'ws://127.0.0.1:40003/' }

        const result = await env.store.apply(next, document.hash)

        expect(result.ok).toBe(false)
        expect(result.error).toContain('已恢复旧配置')
        expect(await env.read()).toEqual(document.config)
        expect(env.restartCalls).toBe(2)
    })

    it('serializes concurrent applies and rejects the stale one', async () => {
        const env = await harness()
        const document = await env.store.read()

        const next = { ...document.config, url: 'ws://127.0.0.1:40004/' }
        const first = env.store.apply(next, document.hash)
        // Queued after the first apply changed the file, so this baseHash
        // is already stale.
        const second = env.store.apply(
            { ...document.config, url: 'ws://127.0.0.1:40005/' },
            document.hash
        )
        const [firstResult] = await Promise.allSettled([first, second])

        expect(firstResult?.status).toBe('fulfilled')

        let error: unknown

        try {
            await second
        } catch (caught) {
            error = caught
        }

        expect(error).toBeInstanceOf(ConfigStoreError)

        const storeError = error as ConfigStoreError

        expect(storeError.status).toBe(409)
    })
})

describe('ConfigStore plugin configs', () => {
    it('reads a missing plugin config as empty', async () => {
        const env = await harness()
        const document = await env.store.readPluginConfig('demo')

        expect(document).toEqual({
            id: 'demo',
            path: join(env.pluginConfigDir, 'demo.jsonc'),
            raw: null,
            hash: null,
            config: {},
            error: null,
            missing: true,
        })
        expect(await env.store.readPluginConfigs()).toEqual([])
    })

    it('reads JSONC with comments and trailing commas', async () => {
        const env = await harness()

        await mkdir(env.pluginConfigDir, { recursive: true })
        await writeFile(
            join(env.pluginConfigDir, 'demo.jsonc'),
            [
                '{',
                '    // hand-written comment',
                '    "enabled": true,',
                '    "token": "secret",',
                '}',
            ].join('\n'),
            'utf8'
        )

        const document = await env.store.readPluginConfig('demo')

        expect(document.error).toBeNull()
        expect(document.missing).toBe(false)
        expect(document.config).toEqual({
            enabled: true,
            token: 'secret',
        })
        expect(document.hash).toMatch(/[0-9a-f]{64}/)
    })

    it('reports invalid JSONC without throwing', async () => {
        const env = await harness()

        await mkdir(env.pluginConfigDir, { recursive: true })
        await writeFile(
            join(env.pluginConfigDir, 'demo.jsonc'),
            '{ "token": ',
            'utf8'
        )

        const document = await env.store.readPluginConfig('demo')

        expect(document.error).toContain('invalid JSONC')
        expect(document.config).toEqual({})
        expect(document.missing).toBe(false)
        expect(await env.store.readPluginConfigs()).toHaveLength(1)
    })

    it('writes canonical JSON and restarts', async () => {
        const env = await harness()
        const result = await env.store.applyPlugin(
            'demo',
            {
                enabled: true,
                private: false,
                groups: { allow: [123], deny: [] },
                token: 'secret',
            },
            null
        )

        expect(result.ok).toBe(true)
        expect(result.hash).toMatch(/[0-9a-f]{64}/)
        expect(env.restartCalls).toBe(1)

        const raw = await readFile(
            join(env.pluginConfigDir, 'demo.jsonc'),
            'utf8'
        )
        const written = JSON.parse(raw) as Record<string, unknown>

        expect(written).toEqual({
            token: 'secret',
            count: 1,
            enabled: true,
            private: false,
            groups: { allow: [123], deny: [] },
        })
        expect(raw).not.toContain('//')
    })

    it('rejects schema errors with 400 and writes nothing', async () => {
        const env = await harness()

        let error: unknown

        try {
            await env.store.applyPlugin('demo', { enabled: true })
        } catch (caught) {
            error = caught
        }

        expect(error).toBeInstanceOf(ConfigStoreError)

        const storeError = error as ConfigStoreError

        expect(storeError.status).toBe(400)
        expect(storeError.issues).toContainEqual({
            path: 'demo.token',
            message: expect.any(String),
        })
        expect((await env.store.readPluginConfig('demo')).missing).toBe(true)
        expect(env.restartCalls).toBe(0)
    })

    it('rejects conflicting group rules with 400', async () => {
        const env = await harness()

        await expect(
            env.store.applyPlugin('demo', {
                token: 'secret',
                groups: { allow: [1], deny: [2] },
            })
        ).rejects.toMatchObject({
            status: 400,
            issues: [{ path: 'demo.groups' }],
        })
    })

    it('rejects an unknown plugin with 404', async () => {
        const env = await harness()

        await expect(
            env.store.applyPlugin('missing', { token: 'secret' })
        ).rejects.toMatchObject({ status: 404 })
    })

    it('rejects a stale base hash with 409', async () => {
        const env = await harness()

        await env.store.applyPlugin('demo', { token: 'secret' })

        await expect(
            env.store.applyPlugin('demo', { token: 'next' }, '0'.repeat(64))
        ).rejects.toMatchObject({ status: 409 })
    })

    it('restores the previous plugin config when restart fails', async () => {
        const env = await harness()

        await env.store.applyPlugin('demo', { token: 'original' })

        const path = join(env.pluginConfigDir, 'demo.jsonc')
        const before = await readFile(path, 'utf8')

        env.setRestartOutcome(false)

        const result = await env.store.applyPlugin('demo', { token: 'next' })

        expect(result.ok).toBe(false)
        expect(result.error).toContain('已恢复旧配置')
        expect(await readFile(path, 'utf8')).toBe(before)
        expect(env.restartCalls).toBe(3)
    })

    it('deletes a newly created file when restart fails', async () => {
        const env = await harness()

        env.setRestartOutcome(false)

        const result = await env.store.applyPlugin('demo', { token: 'secret' })

        expect(result.ok).toBe(false)
        expect((await env.store.readPluginConfig('demo')).missing).toBe(true)
    })
})

describe('maskConfig', () => {
    it('blanks configured secrets and reports which are set', () => {
        const masked = maskConfig({
            ...baseConfig(),
            accessToken: 'top-secret-token',
        })

        const value = masked.config as {
            accessToken?: string
            webui: { password?: string }
        }

        expect(masked.accessTokenSet).toBe(true)
        expect(masked.webuiPasswordSet).toBe(true)
        expect(value.accessToken).toBe('')
        expect(value.webui.password).toBe('')
    })

    it('leaves unset secrets alone', () => {
        const config = baseConfig()

        delete (config as { accessToken?: string }).accessToken
        delete (config as { webui: { password?: string } }).webui.password

        const masked = maskConfig(config)
        const value = masked.config as {
            accessToken?: string
            webui: { password?: string }
        }

        expect(masked.accessTokenSet).toBe(false)
        expect(masked.webuiPasswordSet).toBe(false)
        expect('accessToken' in value).toBe(false)
        expect('password' in value.webui).toBe(false)
    })
})
