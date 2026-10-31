import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { InstallerConfig } from '../../config/schema.js'
import type { Logger } from '../../logging/logger.js'
import { packageDirectoryName } from '../install-dir.js'
import type { PackageValidator } from '../install-validate.js'
import type { NpmRunner } from '../npm-runner.js'
import {
    isPackageAllowed,
    parsePackageSpec,
    PackageSpecError,
    type PackageSpec,
} from '../spec.js'
import type { PluginInstaller } from '../types.js'

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

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
export const NPM_FLAGS = ['--no-audit', '--no-fund', '--loglevel=error']
export const STAGING_MANIFEST = {
    name: '@jsbot-tellus/plugin-staging',
    private: true,
    version: '0.0.0',
    type: 'module',
}

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function asInstallerError(error: unknown): InstallerError {
    if (error instanceof InstallerError) return error

    if (error instanceof PackageSpecError) {
        return new InstallerError(error.message, { cause: error })
    }

    return new InstallerError(messageOf(error), { cause: error })
}

export function installDirectoryName(
    packageName: string,
    pluginIds: readonly string[]
): string {
    const only = pluginIds.length === 1 ? pluginIds[0] : undefined

    return only ?? packageDirectoryName(packageName)
}

export function parseInstallerSpec(
    spec: string,
    allowedPackages: string[]
): PackageSpec {
    const parsed = parsePackageSpec(spec)

    if (!isPackageAllowed(parsed.name, allowedPackages)) {
        throw new InstallerError(`包不在允许列表: ${parsed.name}`)
    }

    return parsed
}

export function temporaryPath(dir: string, kind: 'staging' | 'backup'): string {
    return join(dir, `.${kind}-${randomUUID()}`)
}

export function assertInstallerEnabled(enabled: boolean): void {
    if (!enabled) {
        throw new InstallerError(
            '插件安装功能未启用（installer.enabled=false）'
        )
    }
}

export function createTaskSerializer(): <T>(
    task: () => Promise<T>
) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve()

    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = tail.then(task, task)

        tail = run.then(
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
