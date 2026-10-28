import { randomUUID } from 'node:crypto'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallerConfig } from '../config/schema.js'
import type { Logger } from '../logging/logger.js'
import {
    ensureCoreLink,
    ensureInstallRoot,
    packageDirectoryName,
    pathExists,
    readInstallState,
    readJsonFile,
    readPackageVersion,
    VALIDATE_SCRIPT_FILE,
    writeInstallState,
    type InstalledPackageRecord,
    type InstallState,
} from './install-dir.js'
import {
    validateInstalledPackage,
    type PackageValidator,
    type ValidatedPlugin,
} from './install-validate.js'
import { NpmCliRunner, type NpmRunner } from './npm-runner.js'
import {
    isPackageAllowed,
    parsePackageSpec,
    PackageSpecError,
    type PackageSpec,
} from './spec.js'
import type {
    InstalledPackageInfo,
    PluginInstallResult,
    PluginInstaller,
    PluginRemoveResult,
    PluginUpdateResult,
} from './types.js'

export class InstallerError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InstallerError'
    }
}

export interface InstallerOptions {
    /** Plugins root. Installed packages are placed in subdirectories here. */
    dir: string
    config: InstallerConfig
    logger: Logger
    runner?: NpmRunner | undefined
    validate?: PackageValidator | undefined
    reservedIds?: (() => ReadonlySet<string>) | undefined
    configuredPluginIds?: (() => ReadonlySet<string>) | undefined
    now?: (() => Date) | undefined
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const NPM_FLAGS = ['--no-audit', '--no-fund', '--loglevel=error']
const STAGING_MANIFEST = {
    name: '@jsbot-tellus/plugin-staging',
    private: true,
    version: '0.0.0',
    type: 'module',
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function asInstallerError(error: unknown): InstallerError {
    if (error instanceof InstallerError) return error

    if (error instanceof PackageSpecError) {
        return new InstallerError(error.message, { cause: error })
    }

    return new InstallerError(messageOf(error), { cause: error })
}

function installDirectoryName(
    packageName: string,
    pluginIds: readonly string[]
): string {
    const only = pluginIds.length === 1 ? pluginIds[0] : undefined

    return only ?? packageDirectoryName(packageName)
}

export class NpmPluginInstaller implements PluginInstaller {
    readonly enabled: boolean

    private readonly dir: string
    private readonly config: InstallerConfig
    private readonly logger: Logger
    private readonly runner: NpmRunner
    private readonly validate: PackageValidator
    private readonly reservedIds: () => ReadonlySet<string>
    private readonly configuredPluginIds: () => ReadonlySet<string>
    private readonly now: () => Date
    private tail: Promise<unknown> = Promise.resolve()

    constructor(options: InstallerOptions) {
        this.dir = options.dir
        this.config = options.config
        this.logger = options.logger
        this.enabled = options.config.enabled
        this.runner = options.runner ?? new NpmCliRunner()
        this.validate = options.validate ?? validateInstalledPackage
        this.reservedIds = options.reservedIds ?? (() => new Set())
        this.configuredPluginIds =
            options.configuredPluginIds ?? (() => new Set())
        this.now = options.now ?? (() => new Date())
    }

    async list(): Promise<InstalledPackageInfo[]> {
        const state = await readInstallState(this.dir)
        const loadedIds = this.reservedIds()
        const result: InstalledPackageInfo[] = []

        for (const name of Object.keys(state.packages).sort()) {
            const record = state.packages[name]

            if (!record) continue

            const version =
                (await readPackageVersion(join(this.dir, record.dir))) ??
                record.version

            result.push({
                packageName: name,
                version,
                spec: record.spec,
                pluginIds: [...record.pluginIds],
                installedAt: record.installedAt,
                loaded:
                    record.pluginIds.length > 0 &&
                    record.pluginIds.every((id) => loadedIds.has(id)),
            })
        }

        return result
    }

    install(
        spec: string,
        signal?: AbortSignal | undefined
    ): Promise<PluginInstallResult> {
        try {
            this.assertEnabled()
            const parsed = this.parse(spec)

            return this.serialize(() => this.installSpec(parsed, signal))
        } catch (error) {
            return Promise.reject(asInstallerError(error))
        }
    }

    remove(
        target: string,
        signal?: AbortSignal | undefined,
        options?: { force?: boolean | undefined } | undefined
    ): Promise<PluginRemoveResult> {
        try {
            this.assertEnabled()
        } catch (error) {
            return Promise.reject(asInstallerError(error))
        }

        return this.serialize(async () => {
            const state = await readInstallState(this.dir)
            const name = this.resolveTarget(target, state)
            const record = state.packages[name]

            if (!record) {
                throw new InstallerError(`未找到已安装的插件包: ${name}`)
            }

            const warnings = this.removalWarnings(name, record, state)
            const dependents = this.dependentWarnings(name, record, state)

            if (dependents.length > 0 && options?.force !== true) {
                throw new InstallerError(
                    [
                        `卸载 ${name} 会破坏其它插件包的依赖：`,
                        ...dependents.map((warning) => `- ${warning}`),
                        '确认要卸载时请使用强制卸载（/plugin remove <目标> --force）。',
                    ].join('\n')
                )
            }

            const destination = join(this.dir, record.dir)
            const backup = this.temporaryPath('backup')
            const existed = await pathExists(destination)

            try {
                if (existed) await rename(destination, backup)

                try {
                    delete state.packages[name]
                    await writeInstallState(this.dir, state)
                } catch (error) {
                    if (existed) {
                        await rename(backup, destination).catch(
                            (restoreError) => {
                                this.logger.error(
                                    'failed to restore plugin directory',
                                    restoreError
                                )
                            }
                        )
                    }

                    throw error
                }
            } catch (error) {
                throw asInstallerError(error)
            }

            if (existed) {
                await rm(backup, { recursive: true, force: true }).catch(
                    (error) => {
                        this.logger.warn(
                            `failed to remove backup directory ${backup}`,
                            error
                        )
                    }
                )
            }

            this.logger.info(`removed plugin package ${name}`)

            return {
                packageName: name,
                pluginIds: [...record.pluginIds],
                warnings,
            }
        })
    }

    update(
        target?: string | undefined,
        signal?: AbortSignal | undefined
    ): Promise<PluginUpdateResult> {
        try {
            this.assertEnabled()
        } catch (error) {
            return Promise.reject(asInstallerError(error))
        }

        return this.serialize(async () => {
            const state = await readInstallState(this.dir)
            const names =
                target === undefined || target.trim().length === 0
                    ? Object.keys(state.packages).sort()
                    : [this.resolveTarget(target, state)]

            const updated: PluginInstallResult[] = []
            const failed: Array<{ packageName: string; message: string }> = []

            for (const name of names) {
                if (signal?.aborted) {
                    failed.push({ packageName: name, message: '操作已取消' })
                    continue
                }

                try {
                    const parsed = this.parse(name)

                    updated.push(
                        await this.installSpec(
                            {
                                name: parsed.name,
                                version: 'latest',
                                raw: `${parsed.name}@latest`,
                            },
                            signal
                        )
                    )
                } catch (error) {
                    failed.push({
                        packageName: name,
                        message: messageOf(error),
                    })
                }
            }

            return { updated, failed }
        })
    }

    private async installSpec(
        spec: PackageSpec,
        signal: AbortSignal | undefined
    ): Promise<PluginInstallResult> {
        await ensureInstallRoot(this.dir)

        const state = await readInstallState(this.dir)
        const previous = state.packages[spec.name]
        const staging = this.temporaryPath('staging')
        const backup = this.temporaryPath('backup')
        let target: string | null = null
        let movedTarget = false
        let movedBackup = false

        try {
            await mkdir(staging, { recursive: true })
            await writeFile(
                join(staging, 'package.json'),
                `${JSON.stringify(STAGING_MANIFEST, null, 4)}\n`,
                'utf8'
            )

            await this.runner.run(
                [
                    'install',
                    spec.raw,
                    '--prefix',
                    staging,
                    '--save-exact',
                    ...NPM_FLAGS,
                    ...(this.config.allowScripts ? [] : ['--ignore-scripts']),
                    `--registry=${this.config.registry}`,
                ],
                { timeoutMs: this.config.timeoutMs, signal }
            )

            const packagePath = join(staging, 'node_modules', spec.name)
            const manifest = await readJsonFile(
                join(packagePath, 'package.json')
            )

            if (
                typeof manifest !== 'object' ||
                manifest === null ||
                Array.isArray(manifest)
            ) {
                throw new InstallerError(`npm 没有安装插件包: ${spec.name}`)
            }

            const flat = join(staging, 'flat')

            await cp(packagePath, flat, {
                recursive: true,
                dereference: true,
            })
            await rename(
                join(staging, 'node_modules'),
                join(flat, 'node_modules')
            )
            await rm(join(flat, 'node_modules', spec.name), {
                recursive: true,
                force: true,
            })
            await ensureCoreLink(flat)

            const validated = await this.validate(flat, spec.name, {
                timeoutMs: this.config.timeoutMs,
                signal,
                script: join(this.dir, '.jsbot', VALIDATE_SCRIPT_FILE),
            })

            this.checkPlugins(spec.name, validated, state)

            const version = await readPackageVersion(flat)

            if (version === undefined) {
                throw new InstallerError(`无法读取已安装包的版本: ${spec.name}`)
            }

            const pluginIds = validated.map((plugin) => plugin.id)
            const directory =
                previous?.dir ?? installDirectoryName(spec.name, pluginIds)

            target = join(this.dir, directory)

            await this.assertTargetAvailable(
                state,
                spec.name,
                directory,
                target,
                previous
            )

            const warnings = this.configuredWarnings(
                (previous?.pluginIds ?? []).filter(
                    (id) => !pluginIds.includes(id)
                )
            )

            if (await pathExists(target)) {
                await rename(target, backup)
                movedBackup = true
            }

            await rename(flat, target)
            movedTarget = true

            state.packages[spec.name] = {
                spec: spec.raw,
                version,
                pluginIds,
                dependencies: Object.fromEntries(
                    validated.map((plugin) => [plugin.id, plugin.dependencies])
                ),
                installedAt: this.now().toISOString(),
                dir: directory,
            }

            await writeInstallState(this.dir, state)

            movedTarget = false

            if (movedBackup) {
                await rm(backup, { recursive: true, force: true }).catch(
                    (error) => {
                        this.logger.warn(
                            `failed to remove backup directory ${backup}`,
                            error
                        )
                    }
                )
                movedBackup = false
            }

            this.logger.info(
                `installed plugin package ${spec.name}@${version} into ${target}`
            )

            return {
                packageName: spec.name,
                version,
                pluginIds,
                warnings,
            }
        } catch (error) {
            if (movedTarget && target !== null) {
                await rm(target, { recursive: true, force: true }).catch(
                    (cleanupError) => {
                        this.logger.error(
                            'failed to remove partially installed plugin',
                            cleanupError
                        )
                    }
                )
            }

            if (movedBackup && target !== null) {
                await rename(backup, target).catch((restoreError) => {
                    this.logger.error(
                        'failed to restore previous plugin directory',
                        restoreError
                    )
                })
                movedBackup = false
            }

            throw asInstallerError(error)
        } finally {
            await rm(staging, { recursive: true, force: true }).catch(
                (error) => {
                    this.logger.warn(
                        `failed to remove staging directory ${staging}`,
                        error
                    )
                }
            )
        }
    }

    private async assertTargetAvailable(
        state: InstallState,
        packageName: string,
        directory: string,
        target: string,
        previous: InstalledPackageRecord | undefined
    ): Promise<void> {
        for (const [name, record] of Object.entries(state.packages)) {
            if (name === packageName) continue
            if (record.dir !== directory) continue

            throw new InstallerError(
                `插件目录已被其它已安装包使用: ${record.dir}（${name}）`
            )
        }

        if (previous !== undefined) return

        if (await pathExists(target)) {
            throw new InstallerError(
                `安装目录已存在且不是由安装器管理: ${target}。请先移除该本地插件或为其改名。`
            )
        }
    }

    private checkPlugins(
        packageName: string,
        plugins: ValidatedPlugin[],
        state: InstallState
    ): void {
        const ownIds = new Set(state.packages[packageName]?.pluginIds ?? [])
        const ids = new Set<string>()
        const taken = new Set<string>()

        for (const id of this.reservedIds()) {
            if (!ownIds.has(id)) taken.add(id)
        }

        for (const [name, record] of Object.entries(state.packages)) {
            if (name === packageName) continue

            for (const id of record.pluginIds) taken.add(id)
        }

        for (const plugin of plugins) {
            if (!ID_PATTERN.test(plugin.id)) {
                throw new InstallerError(`插件 id 无效: ${plugin.id}`)
            }

            if (ids.has(plugin.id)) {
                throw new InstallerError(`插件 id 重复: ${plugin.id}`)
            }

            if (taken.has(plugin.id)) {
                throw new InstallerError(
                    `插件 id 已被占用: ${plugin.id}（内置插件或其他已安装包）`
                )
            }

            ids.add(plugin.id)
        }

        const graph = new Map<string, string[]>()

        for (const [name, record] of Object.entries(state.packages)) {
            if (name === packageName) continue

            for (const id of record.pluginIds) {
                graph.set(id, record.dependencies[id] ?? [])
            }
        }

        for (const plugin of plugins) {
            graph.set(plugin.id, plugin.dependencies)
        }

        const reserved = this.reservedIds()
        const available = new Set(graph.keys())

        for (const id of reserved) {
            if (!ownIds.has(id)) available.add(id)
        }

        for (const [id, dependencies] of graph) {
            for (const dependency of dependencies) {
                if (!available.has(dependency)) {
                    throw new InstallerError(
                        `插件 ${id} 依赖未加载的插件: ${dependency}`
                    )
                }
            }
        }

        const visiting = new Set<string>()
        const visited = new Set<string>()

        const visit = (id: string): void => {
            if (visited.has(id)) return

            if (visiting.has(id)) {
                throw new InstallerError(`插件依赖存在循环: ${id}`)
            }

            visiting.add(id)

            for (const dependency of graph.get(id) ?? []) {
                if (graph.has(dependency)) visit(dependency)
            }

            visiting.delete(id)
            visited.add(id)
        }

        for (const id of graph.keys()) visit(id)
    }

    private resolveTarget(target: string, state: InstallState): string {
        const value = target.trim()

        if (value.length === 0) {
            throw new InstallerError('请提供包名或插件 id')
        }

        if (state.packages[value] !== undefined) return value

        for (const [name, record] of Object.entries(state.packages)) {
            if (record.pluginIds.includes(value)) return name
        }

        throw new InstallerError(`未找到已安装的插件包: ${value}`)
    }

    private removalWarnings(
        packageName: string,
        record: InstalledPackageRecord | undefined,
        state: InstallState
    ): string[] {
        return [
            ...this.configuredWarnings(record?.pluginIds ?? []),
            ...this.dependentWarnings(packageName, record, state),
        ]
    }

    private configuredWarnings(pluginIds: readonly string[]): string[] {
        const configured = this.configuredPluginIds()

        return pluginIds
            .filter((id) => configured.has(id))
            .map(
                (id) =>
                    `配置里的 plugins.${id} 仍然存在，重启前请删除，否则会因未知插件 ID 启动失败`
            )
    }

    private dependentWarnings(
        packageName: string,
        record: InstalledPackageRecord | undefined,
        state: InstallState
    ): string[] {
        const removedIds = new Set(record?.pluginIds ?? [])
        const warnings: string[] = []

        for (const [name, other] of Object.entries(state.packages)) {
            if (name === packageName) continue

            for (const [pluginId, dependencies] of Object.entries(
                other.dependencies
            )) {
                for (const dependency of dependencies) {
                    if (!removedIds.has(dependency)) continue

                    warnings.push(
                        `插件包 ${name} 的插件 ${pluginId} 依赖已卸载的插件 ${dependency}`
                    )
                }
            }
        }

        return warnings
    }

    private parse(spec: string): PackageSpec {
        const parsed = parsePackageSpec(spec)

        if (!isPackageAllowed(parsed.name, this.config.allowedPackages)) {
            throw new InstallerError(`包不在允许列表: ${parsed.name}`)
        }

        return parsed
    }

    private temporaryPath(kind: 'staging' | 'backup'): string {
        return join(this.dir, `.${kind}-${randomUUID()}`)
    }

    private assertEnabled(): void {
        if (!this.enabled) {
            throw new InstallerError(
                '插件安装功能未启用（installer.enabled=false）'
            )
        }
    }

    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const run = this.tail.then(task, task)
        this.tail = run.then(
            () => undefined,
            () => undefined
        )
        return run
    }
}

export function createDisabledInstaller(): PluginInstaller {
    const fail = (): Promise<never> =>
        Promise.reject(new InstallerError('插件安装功能未启用'))

    return {
        enabled: false,
        list: () => Promise.resolve([]),
        install: fail,
        remove: fail,
        update: fail,
    }
}
