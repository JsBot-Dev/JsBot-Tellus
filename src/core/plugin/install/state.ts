import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const INSTALL_STATE_FILE = '.jsbot-installed.json'

export interface InstalledPackageRecord {
    spec: string
    version: string
    pluginIds: string[]
    dependencies: Record<string, string[]>
    installedAt: string
    /** Directory name under the plugins root. */
    dir: string
}

export interface InstallState {
    version: 2
    packages: Record<string, InstalledPackageRecord>
}

export class InstallStateError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InstallStateError'
    }
}

export async function readJsonFile(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined

        throw error
    }
}

export async function readPackageVersion(
    directory: string
): Promise<string | undefined> {
    const manifest = await readJsonFile(join(directory, 'package.json')).catch(
        () => undefined
    )

    if (typeof manifest !== 'object' || manifest === null) return undefined

    const version = (manifest as Record<string, unknown>)['version']

    return typeof version === 'string' ? version : undefined
}

export function isSafeDirectoryName(value: string): boolean {
    return (
        value.length > 0 &&
        value !== '.' &&
        value !== '..' &&
        !value.includes('/') &&
        !value.includes('\\')
    )
}

export async function readInstallState(dir: string): Promise<InstallState> {
    const path = join(dir, INSTALL_STATE_FILE)
    let value: unknown

    try {
        value = await readJsonFile(path)
    } catch (error) {
        throw new InstallStateError(`安装状态文件无法解析: ${path}`, {
            cause: error,
        })
    }

    if (value === undefined) {
        return { version: 2, packages: {} }
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InstallStateError(`安装状态文件格式无效: ${path}`)
    }

    if ((value as Record<string, unknown>)['version'] !== 2) {
        throw new InstallStateError(`不支持的安装状态版本，请检查 ${path}`)
    }

    const packages = (value as Record<string, unknown>)['packages']

    if (
        typeof packages !== 'object' ||
        packages === null ||
        Array.isArray(packages)
    ) {
        throw new InstallStateError(`安装状态 packages 字段无效: ${path}`)
    }

    const result: Record<string, InstalledPackageRecord> = {}
    const directories = new Set<string>()

    for (const [name, rawRecord] of Object.entries(packages)) {
        if (
            typeof rawRecord !== 'object' ||
            rawRecord === null ||
            Array.isArray(rawRecord)
        ) {
            throw new InstallStateError(`安装状态记录无效: ${name}`)
        }

        const record = rawRecord as Record<string, unknown>
        const pluginIds = record['pluginIds']
        const dependencies = record['dependencies']
        const directory = record['dir']

        if (
            typeof record['spec'] !== 'string' ||
            typeof record['version'] !== 'string' ||
            typeof record['installedAt'] !== 'string' ||
            typeof directory !== 'string' ||
            !isSafeDirectoryName(directory) ||
            !Array.isArray(pluginIds) ||
            pluginIds.some((item) => typeof item !== 'string')
        ) {
            throw new InstallStateError(`安装状态记录不完整: ${name}`)
        }

        if (directories.has(directory)) {
            throw new InstallStateError(
                `安装状态存在重复的插件目录: ${directory}`
            )
        }

        directories.add(directory)

        if (
            typeof dependencies !== 'object' ||
            dependencies === null ||
            Array.isArray(dependencies)
        ) {
            throw new InstallStateError(`安装状态依赖字段无效: ${name}`)
        }

        const parsedDependencies: Record<string, string[]> = {}

        for (const [id, list] of Object.entries(dependencies)) {
            if (
                !Array.isArray(list) ||
                list.some((item) => typeof item !== 'string')
            ) {
                throw new InstallStateError(
                    `安装状态依赖记录无效: ${name}.${id}`
                )
            }

            parsedDependencies[id] = [...list]
        }

        result[name] = {
            spec: record['spec'],
            version: record['version'],
            pluginIds: [...pluginIds],
            dependencies: parsedDependencies,
            installedAt: record['installedAt'],
            dir: directory,
        }
    }

    return { version: 2, packages: result }
}

export async function writeInstallState(
    dir: string,
    state: InstallState
): Promise<void> {
    const sorted: InstallState = { version: 2, packages: {} }

    for (const name of Object.keys(state.packages).sort()) {
        const record = state.packages[name]
        if (!record) continue
        sorted.packages[name] = record
    }

    const path = join(dir, INSTALL_STATE_FILE)
    const temporary = `${path}.${randomUUID()}.tmp`

    try {
        await writeFile(
            temporary,
            `${JSON.stringify(sorted, null, 4)}\n`,
            'utf8'
        )
        await rename(temporary, path)
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
    }
}
