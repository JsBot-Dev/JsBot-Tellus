import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    ConfigError,
    loadConfig,
    resolveConfigPath,
    resolveDataDir,
} from '../../src/core/config/loader.js'

describe('config', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-config-'))
    })

    afterEach(async () => {
        await rm(directory, {
            recursive: true,
            force: true,
        })
    })

    async function writeConfig(value: unknown): Promise<string> {
        const filePath = join(directory, 'bot.config.json')
        await writeFile(filePath, JSON.stringify(value), 'utf8')

        return filePath
    }

    it('applies defaults for a minimal config', async () => {
        const filePath = await writeConfig({})
        const config = await loadConfig(filePath)

        expect(config).toEqual({
            url: 'ws://127.0.0.1:3001/',
            roles: {
                superadmin: [],
                admin: [],
            },
            message: {
                charThreshold: 50,
                lineThreshold: 3,
            },
            plugins: {},
        })
    })

    it('parses a full config', async () => {
        const filePath = await writeConfig({
            url: 'wss://example.com/ws',
            accessToken: 'secret-token',
            roles: {
                superadmin: [10001],
                admin: [10002],
            },
            message: {
                charThreshold: 100,
                lineThreshold: 5,
            },
            plugins: {
                poke: {
                    enabled: true,
                    groups: {
                        deny: [123456],
                    },
                },
            },
        })

        const config = await loadConfig(filePath)

        expect(config.url).toBe('wss://example.com/ws')
        expect(config.accessToken).toBe('secret-token')
        expect(config.roles.superadmin).toEqual([10001])
        expect(config.roles.admin).toEqual([10002])
        expect(config.message).toEqual({
            charThreshold: 100,
            lineThreshold: 5,
        })
        expect(config.plugins.poke?.enabled).toBe(true)
        expect(config.plugins.poke?.groups).toEqual({
            allow: [],
            deny: [123456],
        })
    })

    it('keeps plugin-specific fields', async () => {
        const filePath = await writeConfig({
            plugins: {
                poke: {
                    enabled: true,
                    cooldownMs: 3000,
                },
            },
        })

        const config = await loadConfig(filePath)

        expect(config.plugins.poke).toMatchObject({
            enabled: true,
            cooldownMs: 3000,
        })
    })

    it('rejects an invalid url with a path', async () => {
        const filePath = await writeConfig({
            url: 'http://example.com/ws',
        })

        await expect(loadConfig(filePath)).rejects.toThrow(/url:/)
    })

    it('rejects unknown top-level fields', async () => {
        const filePath = await writeConfig({
            unknown: true,
        })

        await expect(loadConfig(filePath)).rejects.toThrow(/unknown/)
    })

    it('rejects allow and deny at the same time', async () => {
        const filePath = await writeConfig({
            plugins: {
                poke: {
                    groups: {
                        allow: [111],
                        deny: [222],
                    },
                },
            },
        })

        await expect(loadConfig(filePath)).rejects.toThrow(
            /plugins\.poke\.groups/
        )
    })

    it('reports a missing file', async () => {
        const filePath = join(directory, 'missing.json')

        await expect(loadConfig(filePath)).rejects.toThrow(
            /cannot read config file/
        )
    })

    it('reports invalid JSON', async () => {
        const filePath = join(directory, 'broken.json')
        await writeFile(filePath, '{', 'utf8')

        await expect(loadConfig(filePath)).rejects.toThrow(/invalid JSON/)
    })

    it('uses ConfigError', async () => {
        const filePath = join(directory, 'missing.json')

        await expect(loadConfig(filePath)).rejects.toBeInstanceOf(ConfigError)
    })

    it('resolves config path by CLI, env, then default', () => {
        const cwd = '/tmp/jsbot-path-test'

        expect(
            resolveConfigPath({
                cwd,
                config: 'cli.json',
                env: {
                    BOT_CONFIG: 'env.json',
                },
            })
        ).toBe(resolve(cwd, 'cli.json'))

        expect(
            resolveConfigPath({
                cwd,
                env: {
                    BOT_CONFIG: 'env.json',
                },
            })
        ).toBe(resolve(cwd, 'env.json'))

        expect(
            resolveConfigPath({
                cwd,
                env: {},
            })
        ).toBe(resolve(cwd, 'bot.config.v2.json'))
    })

    it('resolves data dir by CLI, env, then default', () => {
        const cwd = '/tmp/jsbot-path-test'

        expect(
            resolveDataDir({
                cwd,
                dataDir: 'cli-data',
                env: {
                    BOT_DATA_DIR: 'env-data',
                },
            })
        ).toBe(resolve(cwd, 'cli-data'))

        expect(
            resolveDataDir({
                cwd,
                env: {
                    BOT_DATA_DIR: 'env-data',
                },
            })
        ).toBe(resolve(cwd, 'env-data'))

        expect(
            resolveDataDir({
                cwd,
                env: {},
            })
        ).toBe(resolve(cwd, 'data-v2'))
    })

    it('ignores empty path values', () => {
        const cwd = '/tmp/jsbot-path-test'

        expect(
            resolveConfigPath({
                cwd,
                config: '   ',
                env: {},
            })
        ).toBe(resolve(cwd, 'bot.config.v2.json'))
    })
})
