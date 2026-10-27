import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallerConfig } from '../config/schema.js'
import type { Logger } from '../logging/logger.js'
import {
    CORE_PACKAGE_NAME,
    INSTALL_STATE_FILE,
    ensureCoreLink,
    ensureInstallDir,
    readDependencies,
    readInstallState,
    readInstalledVersion,
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
    dir: string
    config: InstallerConfig
    logger: Logger
    runner?: NpmRunner | undefined
    validate?: PackageValidator | undefined
    reservedIds?: (() => ReadonlySet<string>) | undefined
    configuredPluginIds?: (() => ReadonlySet<string>) | undefined
    now?: (() => Date) | undefined
}

interface BackupFile {
    path: string
    content: string | null
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const NPM_FLAGS = ['--no-audit', '--no-fund', '--loglevel=error']

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
        const dependencies = await readDependencies(this.dir)
        const state = await readInstallState(this.dir)
        const loadedIds = this.reservedIds()
        const result: InstalledPackageInfo[] = []

        for (const name of Object.keys(dependencies).sort()) {
            if (name === CORE_PACKAGE_NAME) continue

            const record = state.packages[name]
            const version =
                (await readInstalledVersion(this.dir, name)) ??
                record?.version ??
                ''
            const pluginIds = record?.pluginIds ?? []

            result.push({
                packageName: name,
                version,
                spec: record?.spec ?? dependencies[name] ?? name,
                pluginIds,
                installedAt: record?.installedAt ?? '',
                loaded:
                    pluginIds.length > 0 &&
                    pluginIds.every((id) => loadedIds.has(id)),
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
            await ensureInstallDir(this.dir)

            const dependencies = await readDependencies(this.dir)
            const state = await readInstallState(this.dir)
            this.assertStateCovers(dependencies, state)
            const name = this.resolveTarget(target, dependencies, state)
            const record = state.packages[name]
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

            const backup = await this.backup()

            try {
                await this.runner.run(
                    [
                        'uninstall',
                        name,
                        '--prefix',
                        this.dir,
                        ...NPM_FLAGS,
                        '--ignore-scripts',
                    ],
                    { timeoutMs: this.config.timeoutMs, signal }
                )
                await ensureCoreLink(this.dir)

                delete state.packages[name]
                await writeInstallState(this.dir, state)

                this.logger.info(`removed plugin package ${name}`)

                return {
                    packageName: name,
                    pluginIds: record?.pluginIds ?? [],
                    warnings,
                }
            } catch (error) {
                await this.rollback(backup, error)
                throw asInstallerError(error)
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
            await ensureInstallDir(this.dir)

            const dependencies = await readDependencies(this.dir)
            const state = await readInstallState(this.dir)
            this.assertStateCovers(dependencies, state)
            const names =
                target === undefined || target.trim().length === 0
                    ? Object.keys(dependencies)
                          .filter((name) => name !== CORE_PACKAGE_NAME)
                          .sort()
                    : [this.resolveTarget(target, dependencies, state)]

            const updated: PluginInstallResult[] = []
            const failed: Array<{ packageName: string; message: string }> = []

            if (names.length === 0) {
                return { updated, failed }
            }

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
        await ensureInstallDir(this.dir)

        const previousState = await readInstallState(this.dir)
        const dependencies = await readDependencies(this.dir)
        this.assertStateCovers(dependencies, previousState)
        const backup = await this.backup()

        try {
            await this.runner.run(
                [
                    'install',
                    spec.raw,
                    '--prefix',
                    this.dir,
                    '--save-exact',
                    ...NPM_FLAGS,
                    ...(this.config.allowScripts ? [] : ['--ignore-scripts']),
                    `--registry=${this.config.registry}`,
                ],
                { timeoutMs: this.config.timeoutMs, signal }
            )

            await ensureCoreLink(this.dir)

            const validated = await this.validate(this.dir, spec.name, {
                timeoutMs: this.config.timeoutMs,
                signal,
            })

            this.checkPlugins(spec.name, validated, previousState)

            const version = await readInstalledVersion(this.dir, spec.name)

            if (version === undefined) {
                throw new InstallerError(`无法读取已安装包的版本: ${spec.name}`)
            }

            const pluginIds = validated.map((plugin) => plugin.id)
            const state = previousState
            const warnings = this.configuredWarnings(
                (previousState.packages[spec.name]?.pluginIds ?? []).filter(
                    (id) => !pluginIds.includes(id)
                )
            )

            state.packages[spec.name] = {
                spec: spec.raw,
                version,
                pluginIds,
                dependencies: Object.fromEntries(
                    validated.map((plugin) => [plugin.id, plugin.dependencies])
                ),
                installedAt: this.now().toISOString(),
            }

            await writeInstallState(this.dir, state)

            this.logger.info(`installed plugin package ${spec.name}@${version}`)

            return {
                packageName: spec.name,
                version,
                pluginIds,
                warnings,
            }
        } catch (error) {
            await this.rollback(backup, error)
            throw asInstallerError(error)
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

    private resolveTarget(
        target: string,
        dependencies: Record<string, string>,
        state: InstallState
    ): string {
        const value = target.trim()

        if (value.length === 0) {
            throw new InstallerError('请提供包名或插件 id')
        }

        if (dependencies[value] !== undefined) return value

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

    private assertStateCovers(
        dependencies: Record<string, string>,
        state: InstallState
    ): void {
        const missing = Object.keys(dependencies)
            .filter((name) => name !== CORE_PACKAGE_NAME)
            .filter((name) => state.packages[name] === undefined)
            .sort()

        if (missing.length === 0) return

        throw new InstallerError(
            [
                '安装状态与 package.json 不一致，以下依赖缺少安装记录：',
                ...missing.map((name) => `- ${name}`),
                `请检查安装目录中的 ${INSTALL_STATE_FILE}，或手动清理后重新安装。`,
            ].join('\n')
        )
    }

    private assertEnabled(): void {
        if (!this.enabled) {
            throw new InstallerError(
                '插件安装功能未启用（installer.enabled=false）'
            )
        }
    }

    private async backup(): Promise<BackupFile[]> {
        const files: BackupFile[] = []

        for (const name of [
            'package.json',
            'package-lock.json',
            INSTALL_STATE_FILE,
        ]) {
            const path = join(this.dir, name)

            try {
                files.push({ path, content: await readFile(path, 'utf8') })
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error
                }

                files.push({ path, content: null })
            }
        }

        return files
    }

    private async rollback(files: BackupFile[], cause: unknown): Promise<void> {
        try {
            for (const file of files) {
                if (file.content === null) {
                    await rm(file.path, { force: true })
                } else {
                    await writeFile(file.path, file.content, 'utf8')
                }
            }

            const manifest = files.find((file) =>
                file.path.endsWith('package.json')
            )
            const lock = files.find((file) =>
                file.path.endsWith('package-lock.json')
            )

            if (manifest?.content === null) {
                await rm(join(this.dir, 'node_modules'), {
                    recursive: true,
                    force: true,
                })
                return
            }

            if (lock?.content !== null && lock !== undefined) {
                await this.runner.run(
                    [
                        'ci',
                        '--prefix',
                        this.dir,
                        ...NPM_FLAGS,
                        '--ignore-scripts',
                    ],
                    { timeoutMs: this.config.timeoutMs }
                )
            } else {
                await this.runner.run(
                    [
                        'install',
                        '--prefix',
                        this.dir,
                        ...NPM_FLAGS,
                        '--ignore-scripts',
                    ],
                    { timeoutMs: this.config.timeoutMs }
                )
            }

            await ensureCoreLink(this.dir)
        } catch (error) {
            this.logger.error('plugin install rollback failed', error)
            throw new InstallerError(
                `安装失败且回滚失败：${messageOf(cause)}`,
                { cause }
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
