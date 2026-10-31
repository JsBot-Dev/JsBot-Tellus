import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallerConfig } from '../config/schema.js'
import type { Logger } from '../logging/logger.js'
import {
    ensureCoreLink,
    ensureInstallRoot,
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
} from './install-validate.js'
import {
    assertTargetAvailable,
    checkPlugins,
    resolveTarget,
} from './installer/checks.js'
import {
    asInstallerError,
    assertInstallerEnabled,
    createTaskSerializer,
    installDirectoryName,
    InstallerError,
    messageOf,
    NPM_FLAGS,
    parseInstallerSpec,
    STAGING_MANIFEST,
    temporaryPath,
    type InstallerOptions,
} from './installer/support.js'
import {
    configuredWarnings,
    dependentWarnings,
    removalWarnings,
} from './installer/warnings.js'
import { NpmCliRunner, type NpmRunner } from './npm-runner.js'
import type { PackageSpec } from './spec.js'
import type {
    InstalledPackageInfo,
    PluginInstallResult,
    PluginInstaller,
    PluginRemoveResult,
    PluginUpdateResult,
} from './types.js'

export { createDisabledInstaller, InstallerError } from './installer/support.js'
export type { InstallerOptions } from './installer/support.js'

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
    private readonly serialize = createTaskSerializer()

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
            assertInstallerEnabled(this.enabled)
            const parsed = parseInstallerSpec(spec, this.config.allowedPackages)

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
            assertInstallerEnabled(this.enabled)
        } catch (error) {
            return Promise.reject(asInstallerError(error))
        }

        return this.serialize(async () => {
            const state = await readInstallState(this.dir)
            const name = resolveTarget(target, state)
            const record = state.packages[name]

            if (!record) {
                throw new InstallerError(`未找到已安装的插件包: ${name}`)
            }

            const warnings = removalWarnings(
                name,
                record,
                state,
                this.configuredPluginIds()
            )
            const dependents = dependentWarnings(name, record, state)

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
            const backup = temporaryPath(this.dir, 'backup')
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
            assertInstallerEnabled(this.enabled)
        } catch (error) {
            return Promise.reject(asInstallerError(error))
        }

        return this.serialize(async () => {
            const state = await readInstallState(this.dir)
            const names =
                target === undefined || target.trim().length === 0
                    ? Object.keys(state.packages).sort()
                    : [resolveTarget(target, state)]

            const updated: PluginInstallResult[] = []
            const failed: Array<{ packageName: string; message: string }> = []

            for (const name of names) {
                if (signal?.aborted) {
                    failed.push({ packageName: name, message: '操作已取消' })
                    continue
                }

                try {
                    const parsed = parseInstallerSpec(
                        name,
                        this.config.allowedPackages
                    )

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
        const staging = temporaryPath(this.dir, 'staging')
        const backup = temporaryPath(this.dir, 'backup')
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

            checkPlugins(spec.name, validated, state, () => this.reservedIds())

            const version = await readPackageVersion(flat)

            if (version === undefined) {
                throw new InstallerError(`无法读取已安装包的版本: ${spec.name}`)
            }

            const pluginIds = validated.map((plugin) => plugin.id)
            const directory =
                previous?.dir ?? installDirectoryName(spec.name, pluginIds)

            target = join(this.dir, directory)

            await assertTargetAvailable(
                state,
                spec.name,
                directory,
                target,
                previous
            )

            const warnings = configuredWarnings(
                (previous?.pluginIds ?? []).filter(
                    (id) => !pluginIds.includes(id)
                ),
                this.configuredPluginIds()
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
}
