import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
    loadLocalPlugins,
    loadPluginsFromDirectory,
} from '../../src/core/plugin/loader.js'
import type {
    NpmRunner,
    ProcessOptions,
} from '../../src/core/plugin/npm-runner.js'
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

function pluginSource(id: string): string {
    return [
        "import { z } from 'zod'",
        'export default {',
        `    manifest: { id: '${id}', version: '1.0.0', configSchema: z.object({}) },`,
        '    setup() {},',
        '}',
    ].join('\n')
}

interface BuildCall {
    args: string[]
    options: ProcessOptions
}

function createBuildRunner(onBuild: () => void | Promise<void>): {
    runner: NpmRunner
    calls: BuildCall[]
} {
    const calls: BuildCall[] = []
    const runner: NpmRunner = {
        async run(args, options) {
            calls.push({ args, options })
            await onBuild()
            return { stdout: '', stderr: '' }
        },
    }

    return { runner, calls }
}

interface LocalPluginFixtureOptions {
    build?: string | undefined
    manifest?: unknown | undefined
    nodeModules?: boolean | undefined
}

async function createPluginFixture(
    root: string,
    id: string,
    options: LocalPluginFixtureOptions = {}
): Promise<string> {
    const directory = join(root, id)

    await mkdir(directory, { recursive: true })

    if (options.nodeModules !== false) {
        await mkdir(join(directory, 'node_modules'), { recursive: true })
    }

    const manifest =
        options.manifest ??
        (options.build === undefined
            ? {}
            : { scripts: { build: options.build } })

    await writeFile(
        join(directory, 'package.json'),
        `${JSON.stringify(manifest, null, 4)}\n`,
        'utf8'
    )

    return directory
}

function createLoaderLogger(): {
    warnings: string[]
    errors: string[]
    infos: string[]
    logger: {
        warn(message: string): void
        error(message: string): void
        info(message: string): void
    }
} {
    const warnings: string[] = []
    const errors: string[] = []
    const infos: string[] = []

    return {
        warnings,
        errors,
        infos,
        logger: {
            warn: (message) => warnings.push(message),
            error: (message) => errors.push(message),
            info: (message) => infos.push(message),
        },
    }
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

    it('builds a local plugin without dist', async () => {
        const root = await temporaryDirectory()
        const directory = await createPluginFixture(root, 'demo', {
            build: 'tsc -p tsconfig.json',
        })
        const { runner, calls } = createBuildRunner(async () => {
            await mkdir(join(directory, 'dist'), { recursive: true })
            await writeFile(
                join(directory, 'dist', 'index.mjs'),
                pluginSource('demo'),
                'utf8'
            )
        })
        const { logger, infos } = createLoaderLogger()

        const plugins = await loadLocalPlugins(root, logger, {
            runner,
            buildTimeoutMs: 1_234,
        })

        expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['demo'])
        expect(calls).toHaveLength(1)
        expect(calls[0]?.args).toEqual(['run', 'build'])
        expect(calls[0]?.options).toMatchObject({
            cwd: directory,
            timeoutMs: 1_234,
        })
        expect(infos).toEqual([
            'building local plugin demo: dist directory not found',
            'built local plugin demo',
        ])
    })

    it('skips plugin directories without dist and build script', async () => {
        const root = await temporaryDirectory()
        const { logger, warnings } = createLoaderLogger()

        await mkdir(join(root, 'unbuilt'), { recursive: true })

        const plugins = await loadLocalPlugins(root, logger)

        expect(plugins).toEqual([])
        expect(warnings[0]).toContain('dist directory not found')
        expect(warnings[0]).toContain('no build script')
    })

    it('skips builds when node_modules is missing', async () => {
        const root = await temporaryDirectory()
        const { logger, warnings } = createLoaderLogger()
        const { runner, calls } = createBuildRunner(() => {})

        await createPluginFixture(root, 'demo', {
            build: 'tsc -p tsconfig.json',
            nodeModules: false,
        })

        const plugins = await loadLocalPlugins(root, logger, { runner })

        expect(plugins).toEqual([])
        expect(calls).toHaveLength(0)
        expect(warnings[0]).toContain('node_modules is missing')
        expect(warnings[0]).toContain('npm install --prefix')
    })

    it('skips a plugin when its build fails', async () => {
        const root = await temporaryDirectory()
        const { logger, warnings, errors } = createLoaderLogger()
        const { runner, calls } = createBuildRunner(() => {
            throw new Error('boom')
        })

        await createPluginFixture(root, 'demo', {
            build: 'tsc -p tsconfig.json',
        })

        const plugins = await loadLocalPlugins(root, logger, { runner })

        expect(plugins).toEqual([])
        expect(calls).toHaveLength(1)
        expect(errors[0]).toContain('failed to build local plugin demo')
        expect(warnings).toContain('skipping local plugin demo: build failed')
    })

    it('does not build installer-managed plugins', async () => {
        const root = await temporaryDirectory()
        const { logger, warnings } = createLoaderLogger()
        const { runner, calls } = createBuildRunner(() => {})

        await createPluginFixture(root, 'demo', {
            build: 'tsc -p tsconfig.json',
        })
        await writeFile(
            join(root, '.jsbot-installed.json'),
            `${JSON.stringify(
                {
                    version: 2,
                    packages: {
                        'demo-package': {
                            spec: 'demo-package',
                            version: '1.0.0',
                            pluginIds: ['demo'],
                            dependencies: { demo: [] },
                            installedAt: '2026-01-02T03:04:05.000Z',
                            dir: 'demo',
                        },
                    },
                },
                null,
                4
            )}\n`,
            'utf8'
        )

        const plugins = await loadLocalPlugins(root, logger, { runner })

        expect(plugins).toEqual([])
        expect(calls).toHaveLength(0)
        expect(warnings[0]).toContain(
            'installed package is expected to include dist'
        )
    })

    it('disables auto-build when install state is unreadable', async () => {
        const root = await temporaryDirectory()
        const { logger, warnings } = createLoaderLogger()
        const { runner, calls } = createBuildRunner(() => {})

        await createPluginFixture(root, 'demo', {
            build: 'tsc -p tsconfig.json',
        })
        await writeFile(
            join(root, '.jsbot-installed.json'),
            '{ not valid json',
            'utf8'
        )

        const plugins = await loadLocalPlugins(root, logger, { runner })

        expect(plugins).toEqual([])
        expect(calls).toHaveLength(0)
        expect(warnings[0]).toContain(
            'automatic local plugin build is disabled'
        )
    })

    it('builds a local plugin with npm before loading', async () => {
        const root = await temporaryDirectory()
        const directory = join(root, 'built')

        await mkdir(join(directory, 'node_modules'), { recursive: true })
        await writeFile(
            join(directory, 'package.json'),
            `${JSON.stringify(
                { scripts: { build: 'node build.mjs' } },
                null,
                4
            )}\n`,
            'utf8'
        )
        await writeFile(
            join(directory, 'build.mjs'),
            [
                "import { mkdir, writeFile } from 'node:fs/promises'",
                "await mkdir('dist', { recursive: true })",
                `await writeFile('dist/index.mjs', ${JSON.stringify(
                    pluginSource('built')
                )})`,
            ].join('\n'),
            'utf8'
        )

        const plugins = await loadLocalPlugins(root)

        expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['built'])
    }, 15_000)

    it('returns an empty list when the root does not exist', async () => {
        const root = join(tmpdir(), 'jsbot-missing-local-plugin-directory')

        await expect(loadLocalPlugins(root)).resolves.toEqual([])
    })
})
