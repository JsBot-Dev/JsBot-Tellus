import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    loadLocalPlugins,
    loadPluginsFromDirectory,
} from '../../src/core/plugin/loader.js'
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

describe('directory plugin loader', () => {
    it('loads an example plugin from a directory', async () => {
        const plugins = await loadPluginsFromDirectory(
            resolve('examples/plugins')
        )

        expect(plugins.map((plugin) => plugin.manifest.id)).toContain('hello')
    })

    it('runs a plugin loaded from a directory', async () => {
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

    it('ignores helper modules without plugin exports', async () => {
        const directory = await temporaryDirectory()

        await writeFile(
            join(directory, 'helper.mjs'),
            'export function helper() { return 1 }\n',
            'utf8'
        )
        await writeFile(
            join(directory, 'plugin.mjs'),
            [
                "import { z } from 'zod'",
                'export default {',
                "    manifest: { id: 'plugin', version: '1.0.0', configSchema: z.object({}) },",
                '    setup() {},',
                '}',
            ].join('\n'),
            'utf8'
        )

        const plugins = await loadPluginsFromDirectory(directory)

        expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['plugin'])
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

describe('local plugin loader', () => {
    it('loads plugins from <root>/<id>/dist', async () => {
        const root = await temporaryDirectory()
        const dist = join(root, 'demo', 'dist')

        await mkdir(dist, { recursive: true })
        await writeFile(
            join(dist, 'index.mjs'),
            [
                "import { z } from 'zod'",
                'export default {',
                "    manifest: { id: 'demo', version: '1.0.0', configSchema: z.object({}) },",
                '    setup() {},',
                '}',
            ].join('\n'),
            'utf8'
        )

        const plugins = await loadLocalPlugins(root)

        expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['demo'])
    })

    it('skips plugin directories without dist', async () => {
        const root = await temporaryDirectory()
        const warnings: string[] = []

        await mkdir(join(root, 'unbuilt'), { recursive: true })

        const plugins = await loadLocalPlugins(root, {
            warn: (message) => warnings.push(message),
            error: () => {},
        })

        expect(plugins).toEqual([])
        expect(warnings[0]).toContain('dist directory not found')
    })

    it('returns an empty list when the root does not exist', async () => {
        const root = join(tmpdir(), 'jsbot-missing-local-plugin-directory')

        await expect(loadLocalPlugins(root)).resolves.toEqual([])
    })
})
