import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installerConfigSchema } from '../../src/core/config/schema.js'
import {
    INSTALL_STATE_FILE,
    ensureInstallRoot,
    pathExists,
    readInstallState,
} from '../../src/core/plugin/install-dir.js'
import { NpmPluginInstaller } from '../../src/core/plugin/installer.js'
import { loadLocalPlugins } from '../../src/core/plugin/loader.js'
import {
    ProcessError,
    type NpmRunner,
    type ProcessOptions,
    type ProcessResult,
} from '../../src/core/plugin/npm-runner.js'
import {
    validateInstalledPackage,
    type ValidatedPlugin,
} from '../../src/core/plugin/install-validate.js'
import { createTestLogger } from '../helpers/loggers.js'

interface FakePackage {
    version: string
    latest: string
}

class FakeRunner implements NpmRunner {
    readonly calls: string[][] = []
    readonly packages = new Map<string, FakePackage>()
    failOn: string | null = null
    failCalls = 0
    delayMs = 0
    active = 0
    maxActive = 0

    async run(args: string[], options: ProcessOptions): Promise<ProcessResult> {
        this.calls.push(args)
        this.active += 1
        this.maxActive = Math.max(this.maxActive, this.active)

        try {
            if (this.delayMs > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, this.delayMs)
                )
            }

            if (args[0] === this.failOn && this.failCalls > 0) {
                this.failCalls -= 1
                throw new ProcessError('npm failed', '', 'npm failed')
            }

            const prefix = args.indexOf('--prefix')
            const dir = args[prefix + 1]

            if (dir === undefined) {
                throw new Error(`missing --prefix: ${args.join(' ')}`)
            }

            if (args[0] === 'install') {
                await this.install(dir, args[1])
            }

            return { stdout: '', stderr: '' }
        } finally {
            this.active -= 1
        }
    }

    private async install(dir: string, spec?: string): Promise<void> {
        if (spec === undefined || spec.startsWith('-')) return

        const separator = spec.lastIndexOf('@')
        const name = separator > 0 ? spec.slice(0, separator) : spec
        const requested = separator > 0 ? spec.slice(separator + 1) : undefined
        const pkg = this.packages.get(name)

        if (pkg === undefined) {
            throw new ProcessError(`404 ${name}`, '', 'not found')
        }

        const version =
            requested === undefined || requested === 'latest'
                ? pkg.latest
                : requested
        const manifestPath = join(dir, 'package.json')
        const manifest = JSON.parse(
            await readFile(manifestPath, 'utf8')
        ) as Record<string, unknown>
        const dependencies = {
            ...((manifest['dependencies'] as Record<string, string>) ?? {}),
            [name]: version,
        }

        manifest['dependencies'] = dependencies
        await writeFile(
            manifestPath,
            `${JSON.stringify(manifest, null, 4)}\n`,
            'utf8'
        )
        await writeFile(
            join(dir, 'package-lock.json'),
            `${JSON.stringify({ name: 'fake', lockfileVersion: 3 }, null, 4)}\n`,
            'utf8'
        )
        await writePackage(dir, name, version)
    }
}

async function writePackage(
    dir: string,
    name: string,
    version: string
): Promise<void> {
    const location = join(dir, 'node_modules', name)
    const id = name.startsWith('@') ? name.split('/').at(-1) : name

    await mkdir(join(location, 'dist'), { recursive: true })
    await writeFile(
        join(location, 'package.json'),
        `${JSON.stringify(
            {
                name,
                version,
                type: 'module',
                main: './dist/index.js',
            },
            null,
            4
        )}\n`,
        'utf8'
    )
    await writeFile(
        join(location, 'dist', 'index.js'),
        `export default {
    manifest: {
        id: '${id ?? name}',
        version: '${version}',
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
    },
    setup() {},
}
`,
        'utf8'
    )
}

class FakeValidator {
    readonly plugins = new Map<string, ValidatedPlugin[]>()
    readonly calls: Array<{ dir: string; name: string }> = []

    async validate(dir: string, name: string): Promise<ValidatedPlugin[]> {
        this.calls.push({ dir, name })
        const value = this.plugins.get(name)

        if (value === undefined) {
            throw new Error(`package is not a plugin: ${name}`)
        }

        return value
    }
}

function plugin(id: string, dependencies: string[] = []): ValidatedPlugin {
    return { id, version: '1.0.0', dependencies }
}

describe('NpmPluginInstaller', () => {
    let directory: string
    let runner: FakeRunner
    let validator: FakeValidator

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-installer-'))
        await ensureInstallRoot(directory)
        runner = new FakeRunner()
        validator = new FakeValidator()
    })

    afterEach(async () => {
        await rm(directory, {
            recursive: true,
            force: true,
        })
    })

    function createInstaller(
        overrides: {
            enabled?: boolean
            allowedPackages?: string[]
            allowScripts?: boolean
            reservedIds?: string[]
            configuredPluginIds?: string[]
            realValidator?: boolean
        } = {}
    ): NpmPluginInstaller {
        return new NpmPluginInstaller({
            dir: directory,
            config: installerConfigSchema.parse({
                enabled: overrides.enabled ?? true,
                ...(overrides.allowedPackages !== undefined
                    ? { allowedPackages: overrides.allowedPackages }
                    : {}),
                ...(overrides.allowScripts !== undefined
                    ? { allowScripts: overrides.allowScripts }
                    : {}),
            }),
            logger: createTestLogger('installer'),
            runner,
            ...(overrides.realValidator
                ? { validate: validateInstalledPackage }
                : {
                      validate: (dir, name) => validator.validate(dir, name),
                  }),
            reservedIds: () => new Set(overrides.reservedIds ?? []),
            configuredPluginIds: () =>
                new Set(overrides.configuredPluginIds ?? []),
            now: () => new Date('2026-01-02T03:04:05.000Z'),
        })
    }

    function registerPackage(
        name: string,
        options: {
            version?: string
            latest?: string
            plugins?: ValidatedPlugin[]
        } = {}
    ): void {
        const version = options.version ?? '1.0.0'

        runner.packages.set(name, {
            version,
            latest: options.latest ?? version,
        })
        validator.plugins.set(name, options.plugins ?? [plugin(name)])
    }

    async function state() {
        return readInstallState(directory)
    }

    it('installs a package into plugins/<id>/dist', async () => {
        registerPackage('demo-plugin')
        const installer = createInstaller()

        const result = await installer.install('demo-plugin')

        expect(result).toEqual({
            packageName: 'demo-plugin',
            version: '1.0.0',
            pluginIds: ['demo-plugin'],
            warnings: [],
        })

        const record = (await state()).packages['demo-plugin']

        expect(record).toMatchObject({
            spec: 'demo-plugin',
            version: '1.0.0',
            pluginIds: ['demo-plugin'],
            dir: 'demo-plugin',
            installedAt: '2026-01-02T03:04:05.000Z',
        })
        expect(
            await pathExists(join(directory, 'demo-plugin', 'dist', 'index.js'))
        ).toBe(true)
        expect(
            await pathExists(
                join(directory, 'demo-plugin', 'node_modules', 'demo-plugin')
            )
        ).toBe(false)
        expect(
            await pathExists(join(directory, 'node_modules', 'demo-plugin'))
        ).toBe(false)

        const loaded = await loadLocalPlugins(directory)

        expect(loaded.map((item) => item.manifest.id)).toEqual(['demo-plugin'])

        const call = runner.calls.find((args) => args[1] === 'demo-plugin')

        expect(call).toBeDefined()
        expect(call).toContain('--save-exact')
        expect(call).toContain('--ignore-scripts')
        expect(call).toContain('--registry=https://registry.npmjs.org/')

        expect(await installer.list()).toEqual([
            {
                packageName: 'demo-plugin',
                version: '1.0.0',
                spec: 'demo-plugin',
                pluginIds: ['demo-plugin'],
                installedAt: '2026-01-02T03:04:05.000Z',
                loaded: false,
            },
        ])
    })

    it('validates the flattened directory with the real validator', async () => {
        registerPackage('real-plugin')
        const installer = createInstaller({ realValidator: true })

        const result = await installer.install('real-plugin')

        expect(result.pluginIds).toEqual(['real-plugin'])
        expect(
            await pathExists(
                join(
                    directory,
                    'real-plugin',
                    'node_modules',
                    '@jsbot-tellus',
                    'core'
                )
            )
        ).toBe(true)
    })

    it('reports a corrupted install state instead of resetting it', async () => {
        await writeFile(
            join(directory, INSTALL_STATE_FILE),
            '{ not json',
            'utf8'
        )

        await expect(createInstaller().list()).rejects.toThrow(
            /安装状态文件无法解析/
        )
    })

    it('refuses to overwrite an unmanaged local plugin directory', async () => {
        registerPackage('demo-plugin')
        await mkdir(join(directory, 'demo-plugin', 'dist'), {
            recursive: true,
        })

        await expect(createInstaller().install('demo-plugin')).rejects.toThrow(
            /安装目录已存在且不是由安装器管理/
        )
        expect((await state()).packages).toEqual({})
    })

    it('honours exact versions and dist-tags', async () => {
        registerPackage('demo-plugin', {
            version: '1.0.0',
            latest: '2.0.0',
        })
        const installer = createInstaller()

        await installer.install('demo-plugin@1.0.0')
        expect((await state()).packages['demo-plugin']?.version).toBe('1.0.0')

        await installer.install('demo-plugin@latest')
        expect((await state()).packages['demo-plugin']?.version).toBe('2.0.0')
    })

    it('runs install scripts only when allowed', async () => {
        registerPackage('demo-plugin')
        await createInstaller({ allowScripts: true }).install('demo-plugin')

        const call = runner.calls.find((args) => args[1] === 'demo-plugin')

        expect(call).not.toContain('--ignore-scripts')
    })

    it('rejects non-registry specs and version ranges', async () => {
        const installer = createInstaller()

        for (const spec of [
            'git+https://example.com/repo.git',
            'file:../plugin',
            'https://example.com/plugin.tgz',
            'github:user/repo',
            'demo-plugin@^1.2.3',
            'demo-plugin@1.x',
            'demo-plugin@latest || 2',
            '../local-plugin',
        ]) {
            await expect(installer.install(spec)).rejects.toThrow()
        }

        expect(runner.calls).toHaveLength(0)
    })

    it('rejects packages outside the allowlist', async () => {
        registerPackage('demo-plugin')
        await expect(
            createInstaller({ allowedPackages: ['@scope/*'] }).install(
                'demo-plugin'
            )
        ).rejects.toThrow('不在允许列表')

        expect(runner.calls).toHaveLength(0)
    })

    it('allows scoped packages through a wildcard entry', async () => {
        registerPackage('@scope/plugin', {
            plugins: [plugin('scope-plugin')],
        })
        const result = await createInstaller({
            allowedPackages: ['@scope/*'],
        }).install('@scope/plugin')

        expect(result.packageName).toBe('@scope/plugin')
        expect((await state()).packages['@scope/plugin']?.dir).toBe(
            'scope-plugin'
        )
    })

    it('uses the package name for packages with multiple plugins', async () => {
        registerPackage('@scope/bundle', {
            plugins: [plugin('first'), plugin('second')],
        })

        await createInstaller().install('@scope/bundle')

        expect((await state()).packages['@scope/bundle']?.dir).toBe(
            '@scope__bundle'
        )
        expect(
            await pathExists(
                join(directory, '@scope__bundle', 'dist', 'index.js')
            )
        ).toBe(true)
    })

    it('rolls back when npm fails', async () => {
        registerPackage('demo-plugin')
        runner.failOn = 'install'
        runner.failCalls = 1

        await expect(createInstaller().install('demo-plugin')).rejects.toThrow(
            'npm failed'
        )

        expect((await state()).packages).toEqual({})
        expect(await createInstaller().list()).toEqual([])
        expect(await pathExists(join(directory, 'demo-plugin'))).toBe(false)
    })

    it('rolls back when package validation fails', async () => {
        runner.packages.set('not-a-plugin', {
            version: '1.0.0',
            latest: '1.0.0',
        })

        await expect(createInstaller().install('not-a-plugin')).rejects.toThrow(
            'not a plugin'
        )

        expect((await state()).packages).toEqual({})
        expect(await createInstaller().list()).toEqual([])
    })

    it('rejects plugin ids that are already reserved', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('core')],
        })

        await expect(
            createInstaller({ reservedIds: ['core'] }).install('demo-plugin')
        ).rejects.toThrow('插件 id 已被占用: core')

        expect((await state()).packages).toEqual({})
    })

    it('rejects plugin ids used by another installed package', async () => {
        registerPackage('first-plugin', {
            plugins: [plugin('shared')],
        })
        registerPackage('second-plugin', {
            plugins: [plugin('shared')],
        })
        const installer = createInstaller()

        await installer.install('first-plugin')

        await expect(installer.install('second-plugin')).rejects.toThrow(
            '插件 id 已被占用: shared'
        )
        expect(Object.keys((await state()).packages)).toEqual(['first-plugin'])
    })

    it('rejects duplicate ids within one package', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('demo'), plugin('demo')],
        })

        await expect(createInstaller().install('demo-plugin')).rejects.toThrow(
            '插件 id 重复: demo'
        )
    })

    it('rejects plugin dependencies that are not available', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('demo', ['missing'])],
        })

        await expect(createInstaller().install('demo-plugin')).rejects.toThrow(
            '依赖未加载的插件: missing'
        )
    })

    it('accepts dependencies provided by the same package', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('demo', ['helper']), plugin('helper')],
        })

        const result = await createInstaller().install('demo-plugin')

        expect(result.pluginIds).toEqual(['demo', 'helper'])
    })

    it('lists packages as loaded when their plugins are active', async () => {
        registerPackage('demo-plugin')
        await createInstaller().install('demo-plugin')

        const restarted = createInstaller({ reservedIds: ['demo-plugin'] })

        expect((await restarted.list())[0]?.loaded).toBe(true)
    })

    it('removes a package directory and reports configured plugin ids', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('demo')],
        })
        const installer = createInstaller({
            configuredPluginIds: ['demo'],
        })

        await installer.install('demo-plugin')

        const result = await installer.remove('demo')

        expect(result.packageName).toBe('demo-plugin')
        expect(result.pluginIds).toEqual(['demo'])
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]).toContain('plugins.demo')
        expect((await state()).packages).toEqual({})
        expect(await pathExists(join(directory, 'demo'))).toBe(false)
        expect(await installer.list()).toEqual([])
    })

    it('refuses to remove a plugin another package depends on', async () => {
        registerPackage('base-plugin', {
            plugins: [plugin('base')],
        })
        registerPackage('app-plugin', {
            plugins: [plugin('app', ['base'])],
        })
        const installer = createInstaller()

        await installer.install('base-plugin')
        await installer.install('app-plugin')

        await expect(installer.remove('base')).rejects.toThrow(
            /会破坏其它插件包的依赖/
        )
        expect(Object.keys((await state()).packages)).toEqual([
            'app-plugin',
            'base-plugin',
        ])
    })

    it('allows a forced removal with dependency warnings', async () => {
        registerPackage('base-plugin', {
            plugins: [plugin('base')],
        })
        registerPackage('app-plugin', {
            plugins: [plugin('app', ['base'])],
        })
        const installer = createInstaller()

        await installer.install('base-plugin')
        await installer.install('app-plugin')

        const result = await installer.remove('base', undefined, {
            force: true,
        })

        expect(
            result.warnings.some(
                (warning) =>
                    warning.includes('app-plugin') &&
                    warning.includes('已卸载的插件 base')
            )
        ).toBe(true)
        expect(Object.keys((await state()).packages)).toEqual(['app-plugin'])
    })

    it('rejects self-dependencies and dependency cycles', async () => {
        registerPackage('self-plugin', {
            plugins: [plugin('self', ['self'])],
        })
        await expect(createInstaller().install('self-plugin')).rejects.toThrow(
            /循环/
        )

        registerPackage('cycle-plugin', {
            plugins: [plugin('first', ['second']), plugin('second', ['first'])],
        })

        await expect(createInstaller().install('cycle-plugin')).rejects.toThrow(
            /循环/
        )
    })

    it('returns an empty update result when nothing is installed', async () => {
        await expect(createInstaller().update()).resolves.toEqual({
            updated: [],
            failed: [],
        })
    })

    it('updates a package to the latest version', async () => {
        registerPackage('demo-plugin', {
            version: '1.0.0',
            latest: '2.0.0',
        })
        const installer = createInstaller()

        await installer.install('demo-plugin')
        const result = await installer.update('demo-plugin')

        expect(result.failed).toEqual([])
        expect(result.updated).toEqual([
            {
                packageName: 'demo-plugin',
                version: '2.0.0',
                pluginIds: ['demo-plugin'],
                warnings: [],
            },
        ])
        expect((await state()).packages['demo-plugin']?.version).toBe('2.0.0')
        expect(
            JSON.parse(
                await readFile(
                    join(directory, 'demo-plugin', 'package.json'),
                    'utf8'
                )
            )
        ).toMatchObject({ version: '2.0.0' })
    })

    it('keeps the existing directory when an update changes plugin ids', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('old')],
        })
        const installer = createInstaller()

        await installer.install('demo-plugin')

        registerPackage('demo-plugin', {
            version: '1.0.0',
            latest: '2.0.0',
            plugins: [plugin('new')],
        })

        const result = await installer.update('demo-plugin')
        const record = (await state()).packages['demo-plugin']

        expect(result.updated[0]?.pluginIds).toEqual(['new'])
        expect(record?.dir).toBe('old')
        expect(await pathExists(join(directory, 'old', 'dist'))).toBe(true)
        expect(await pathExists(join(directory, 'new'))).toBe(false)
    })

    it('warns when an update removes a configured plugin id', async () => {
        registerPackage('demo-plugin', {
            plugins: [plugin('old')],
        })
        const installer = createInstaller({ configuredPluginIds: ['old'] })

        await installer.install('demo-plugin')

        registerPackage('demo-plugin', {
            version: '1.0.0',
            latest: '2.0.0',
            plugins: [plugin('new')],
        })

        const result = await installer.update('demo-plugin')

        expect(result.updated[0]?.warnings).toEqual([
            expect.stringContaining('plugins.old'),
        ])
    })

    it('applies the allowlist to updates', async () => {
        registerPackage('demo-plugin', {
            version: '1.0.0',
            latest: '2.0.0',
        })
        await createInstaller().install('demo-plugin')

        const result = await createInstaller({
            allowedPackages: ['other-plugin'],
        }).update()

        expect(result.updated).toEqual([])
        expect(result.failed[0]?.message).toContain('不在允许列表')
    })

    it('reports update failures without aborting other packages', async () => {
        registerPackage('ok-plugin', { version: '1.0.0', latest: '2.0.0' })
        registerPackage('bad-plugin', { version: '1.0.0', latest: '2.0.0' })
        const installer = createInstaller()

        await installer.install('ok-plugin')
        await installer.install('bad-plugin')

        const before = (await state()).packages['bad-plugin']?.version

        validator.plugins.delete('bad-plugin')

        const result = await installer.update()

        expect(result.updated.map((item) => item.packageName)).toEqual([
            'ok-plugin',
        ])
        expect(result.failed).toHaveLength(1)
        expect(result.failed[0]?.packageName).toBe('bad-plugin')
        expect((await state()).packages['bad-plugin']?.version).toBe(before)
    })

    it('rejects operations when disabled', async () => {
        const installer = createInstaller({ enabled: false })

        expect(installer.enabled).toBe(false)
        await expect(installer.install('demo-plugin')).rejects.toThrow(
            '插件安装功能未启用'
        )
        await expect(installer.remove('demo-plugin')).rejects.toThrow(
            '插件安装功能未启用'
        )
        await expect(installer.update()).rejects.toThrow('插件安装功能未启用')
        expect(runner.calls).toHaveLength(0)
    })

    it('serializes concurrent operations', async () => {
        registerPackage('first-plugin')
        registerPackage('second-plugin')
        runner.delayMs = 5
        const installer = createInstaller()

        await Promise.all([
            installer.install('first-plugin'),
            installer.install('second-plugin'),
        ])

        expect(runner.maxActive).toBe(1)
        expect(Object.keys((await state()).packages)).toEqual([
            'first-plugin',
            'second-plugin',
        ])
    })
})
