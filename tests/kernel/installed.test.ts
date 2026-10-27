import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    corePackageRoot,
    ensureInstallDir,
} from '../../src/core/plugin/install-dir.js'
import {
    loadInstalledPlugins,
    packageEntry,
} from '../../src/core/plugin/installed.js'
import { createCapturingLogger } from '../helpers/loggers.js'

async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`, 'utf8')
}

async function writePackage(
    directory: string,
    name: string,
    options: {
        manifest?: Record<string, unknown>
        entry?: string
        entryFile?: string
    } = {}
): Promise<void> {
    const location = join(directory, 'node_modules', name)

    await writeJson(join(location, 'package.json'), {
        name,
        version: '1.0.0',
        type: 'module',
        exports: {
            '.': {
                import: './index.js',
            },
        },
        ...options.manifest,
    })
    await writeFile(
        join(location, options.entryFile ?? 'index.js'),
        options.entry ?? '',
        'utf8'
    )
}

function pluginEntry(id: string): string {
    return `export default {
    manifest: {
        id: '${id}',
        version: '1.0.0',
        configSchema: {},
    },
    setup() {},
}
`
}

describe('loadInstalledPlugins', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-installed-'))
        await ensureInstallDir(directory)
    })

    afterEach(async () => {
        await rm(directory, {
            recursive: true,
            force: true,
        })
    })

    async function setDependencies(
        dependencies: Record<string, string>
    ): Promise<void> {
        await writeJson(join(directory, 'package.json'), {
            name: '@jsbot/installed-plugins',
            private: true,
            version: '0.0.0',
            type: 'module',
            dependencies,
        })
    }

    it('returns nothing when the install directory is empty', async () => {
        const { logger } = createCapturingLogger('installed')
        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins).toEqual([])
        expect(result.byPackage.size).toBe(0)
    })

    it('loads plugins from the package root export', async () => {
        await setDependencies({ 'demo-plugin': '1.0.0' })
        await writePackage(directory, 'demo-plugin', {
            entry: pluginEntry('demo'),
        })
        const { logger } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual([
            'demo',
        ])
        expect(result.byPackage.get('demo-plugin')).toEqual(['demo'])
    })

    it('creates the @jsbot/core link in the install directory', async () => {
        const { logger } = createCapturingLogger('installed')

        await loadInstalledPlugins(directory, logger)

        const link = join(directory, 'node_modules', '@jsbot', 'core')
        expect(await realpath(link)).toBe(await realpath(corePackageRoot()))
    })

    it('supports named exports and arrays of plugins', async () => {
        await setDependencies({
            'named-plugin': '1.0.0',
            'array-plugin': '1.0.0',
        })
        await writePackage(directory, 'named-plugin', {
            entry: `export const plugin = {
    manifest: { id: 'named', version: '1.0.0', configSchema: {} },
    setup() {},
}
`,
        })
        await writePackage(directory, 'array-plugin', {
            entry: `const first = {
    manifest: { id: 'first', version: '1.0.0', configSchema: {} },
    setup() {},
}
const second = {
    manifest: { id: 'second', version: '1.0.0', configSchema: {} },
    setup() {},
}
export const plugins = [first, second]
`,
        })
        const { logger } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.byPackage.get('named-plugin')).toEqual(['named'])
        expect(result.byPackage.get('array-plugin')).toEqual([
            'first',
            'second',
        ])
    })

    it('uses main when exports is absent', async () => {
        await setDependencies({ 'main-plugin': '1.0.0' })
        await writePackage(directory, 'main-plugin', {
            manifest: {
                main: './entry.js',
                exports: undefined,
            },
            entryFile: 'entry.js',
            entry: pluginEntry('main-plugin'),
        })
        const { logger } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual([
            'main-plugin',
        ])
    })

    it('skips missing packages with a warning', async () => {
        await setDependencies({ 'missing-plugin': '1.0.0' })
        const { logger, records } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins).toEqual([])
        expect(
            records.some((record) =>
                record.message.includes('installed plugin package missing')
            )
        ).toBe(true)
    })

    it('isolates packages that fail to load', async () => {
        await setDependencies({
            'bad-plugin': '1.0.0',
            'good-plugin': '1.0.0',
        })
        await writePackage(directory, 'bad-plugin', {
            entry: 'export default 42\n',
        })
        await writePackage(directory, 'good-plugin', {
            entry: pluginEntry('good'),
        })
        const { logger, records } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual([
            'good',
        ])
        expect(
            records.some(
                (record) =>
                    record.level === 'error' &&
                    record.message.includes(
                        'failed to load installed plugin package: bad-plugin'
                    )
            )
        ).toBe(true)
    })

    it('warns when a package exports no plugin', async () => {
        await setDependencies({ 'empty-plugin': '1.0.0' })
        await writePackage(directory, 'empty-plugin', {
            entry: 'export const value = 1\n',
        })
        const { logger, records } = createCapturingLogger('installed')

        const result = await loadInstalledPlugins(directory, logger)

        expect(result.plugins).toEqual([])
        expect(
            records.some((record) =>
                record.message.includes('installed package exported no plugin')
            )
        ).toBe(true)
    })
})

describe('packageEntry', () => {
    it('resolves the import condition', () => {
        const entry = packageEntry('/tmp/demo', {
            exports: {
                '.': {
                    types: './index.d.ts',
                    import: './index.js',
                },
            },
        })

        expect(entry).toBe(join('/tmp/demo', './index.js'))
    })

    it('rejects exports without a root entry', () => {
        expect(() =>
            packageEntry('/tmp/demo', {
                exports: {
                    './sub': './sub.js',
                },
            })
        ).toThrow('没有定义根入口')
    })
})
