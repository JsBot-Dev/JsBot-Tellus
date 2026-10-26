import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPluginsFromDirectory } from '../../src/core/plugin/loader.js'
import { pluginEnvelopeSchema } from '../../src/core/config/schema.js'
import { corePlugin } from '../../src/plugins/core/index.js'
import { groupMessage } from '../helpers/events.js'
import { createTestApp } from '../helpers/test-app.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'jsbot-plugins-'))

    temporaryDirectories.push(directory)

    return directory
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true }))
    )
})

describe('external plugin loader', () => {
    it('loads an example plugin from a directory', async () => {
        const plugins = await loadPluginsFromDirectory(
            resolve('examples/plugins')
        )

        expect(plugins.map((plugin) => plugin.manifest.id)).toContain('hello')
    })

    it('runs an externally loaded plugin', async () => {
        const plugins = await loadPluginsFromDirectory(
            resolve('examples/plugins')
        )
        const app = await createTestApp({
            plugins: [...plugins, corePlugin],
            pluginConfigs: {
                hello: {
                    reply: 'external reply',
                },
            },
        })

        const result = await app.dispatch(
            groupMessage({ raw_message: '/hello' })
        )

        expect(result.replies[0]?.message).toBe('external reply')

        await app.stop()
    })

    it('loads default, named and grouped exports', async () => {
        const directory = await temporaryDirectory()

        await writeFile(
            join(directory, 'default.mjs'),
            [
                "import { z } from 'zod'",
                'export default {',
                "    manifest: { id: 'default', version: '1.0.0', configSchema: z.object({}) },",
                '    setup() {},',
                '}',
            ].join('\n'),
            'utf8'
        )
        await writeFile(
            join(directory, 'named.mjs'),
            [
                "import { z } from 'zod'",
                'export const plugin = {',
                "    manifest: { id: 'named', version: '1.0.0', configSchema: z.object({}) },",
                '    setup() {},',
                '}',
            ].join('\n'),
            'utf8'
        )
        await writeFile(
            join(directory, 'grouped.mjs'),
            [
                "import { z } from 'zod'",
                "const one = { manifest: { id: 'one', version: '1.0.0', configSchema: z.object({}) }, setup() {} }",
                "const two = { manifest: { id: 'two', version: '1.0.0', configSchema: z.object({}) }, setup() {} }",
                'export const plugins = [one, two]',
            ].join('\n'),
            'utf8'
        )

        const plugins = await loadPluginsFromDirectory(directory)

        expect(plugins.map((plugin) => plugin.manifest.id).sort()).toEqual([
            'default',
            'named',
            'one',
            'two',
        ])
    })

    it('rejects a missing directory', async () => {
        await expect(
            loadPluginsFromDirectory(
                join(tmpdir(), 'jsbot-missing-plugin-directory')
            )
        ).rejects.toThrow(/plugin directory not found/)
    })

    it('rejects invalid plugin exports', async () => {
        const directory = await temporaryDirectory()

        await writeFile(
            join(directory, 'invalid.mjs'),
            'export default { nope: true }',
            'utf8'
        )

        await expect(loadPluginsFromDirectory(directory)).rejects.toThrow(
            /invalid plugin export/
        )
    })

    it('keeps plugin-specific config fields', () => {
        const config = pluginEnvelopeSchema.parse({
            enabled: true,
            cooldownMs: 1000,
        })

        expect(config).toMatchObject({
            enabled: true,
            cooldownMs: 1000,
        })
    })
})
