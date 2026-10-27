import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
    mkdir,
    readFile,
    realpath,
    rename,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CORE_PACKAGE_NAME = '@jsbot-tellus/core'
export const INSTALL_PACKAGE_NAME = '@jsbot-tellus/installed-plugins'
export const INSTALL_STATE_FILE = '.jsbot-installed.json'
export const VALIDATE_SCRIPT_FILE = 'validate.mjs'

export interface InstalledPackageRecord {
    spec: string
    version: string
    pluginIds: string[]
    dependencies: Record<string, string[]>
    installedAt: string
}

export interface InstallState {
    version: 1
    packages: Record<string, InstalledPackageRecord>
}

export class InstallStateError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InstallStateError'
    }
}

const INSTALL_MANIFEST = {
    name: INSTALL_PACKAGE_NAME,
    private: true,
    version: '0.0.0',
    type: 'module',
    dependencies: {},
}

export function resolveInstallDir(
    config: { dir?: string | undefined },
    dataDir: string
): string {
    return config.dir
        ? resolve(process.cwd(), config.dir)
        : join(dataDir, 'plugins')
}

export function packageDir(dir: string, name: string): string {
    return join(dir, 'node_modules', name)
}

export async function readJsonFile(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined

        throw error
    }
}

export async function ensureInstallDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })

    const manifestPath = join(dir, 'package.json')
    const manifest = await readJsonFile(manifestPath)

    if (manifest === undefined) {
        await writeFile(
            manifestPath,
            `${JSON.stringify(INSTALL_MANIFEST, null, 4)}\n`
        )
    } else if (
        typeof manifest !== 'object' ||
        manifest === null ||
        Array.isArray(manifest)
    ) {
        throw new Error(`安装目录的 package.json 无效: ${manifestPath}`)
    }

    await mkdir(join(dir, '.jsbot'), { recursive: true })
    await writeFile(
        join(dir, '.jsbot', VALIDATE_SCRIPT_FILE),
        VALIDATE_SCRIPT,
        'utf8'
    )
}

export async function readDependencies(
    dir: string
): Promise<Record<string, string>> {
    const manifest = await readJsonFile(join(dir, 'package.json'))

    if (typeof manifest !== 'object' || manifest === null) return {}

    const dependencies = (manifest as Record<string, unknown>)['dependencies']

    if (
        typeof dependencies !== 'object' ||
        dependencies === null ||
        Array.isArray(dependencies)
    ) {
        return {}
    }

    const result: Record<string, string> = {}

    for (const [name, value] of Object.entries(dependencies)) {
        if (typeof value === 'string') {
            result[name] = value
        }
    }

    return result
}

export async function readInstalledVersion(
    dir: string,
    name: string
): Promise<string | undefined> {
    const manifest = await readJsonFile(
        join(packageDir(dir, name), 'package.json')
    ).catch(() => undefined)

    if (typeof manifest !== 'object' || manifest === null) return undefined

    const version = (manifest as Record<string, unknown>)['version']

    return typeof version === 'string' ? version : undefined
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
        return { version: 1, packages: {} }
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InstallStateError(`安装状态文件格式无效: ${path}`)
    }

    if ((value as Record<string, unknown>)['version'] !== 1) {
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

        if (
            typeof record['spec'] !== 'string' ||
            typeof record['version'] !== 'string' ||
            typeof record['installedAt'] !== 'string' ||
            !Array.isArray(pluginIds) ||
            pluginIds.some((item) => typeof item !== 'string')
        ) {
            throw new InstallStateError(`安装状态记录不完整: ${name}`)
        }

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
        }
    }

    return { version: 1, packages: result }
}

export async function writeInstallState(
    dir: string,
    state: InstallState
): Promise<void> {
    const sorted: InstallState = { version: 1, packages: {} }

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

export function corePackageRoot(): string {
    let current = dirname(fileURLToPath(import.meta.url))

    for (;;) {
        try {
            const manifest = JSON.parse(
                readFileSync(join(current, 'package.json'), 'utf8')
            ) as Record<string, unknown>

            if (manifest['name'] === CORE_PACKAGE_NAME) return current
        } catch {
            // keep walking up
        }

        const parent = dirname(current)

        if (parent === current) {
            throw new Error(`cannot locate ${CORE_PACKAGE_NAME} package root`)
        }

        current = parent
    }
}

export async function ensureCoreLink(dir: string): Promise<void> {
    const target = corePackageRoot()
    const link = join(dir, 'node_modules', '@jsbot-tellus', 'core')

    await mkdir(dirname(link), { recursive: true })

    const existing = await realpath(link).catch(() => null)

    if (existing !== null) {
        const resolvedTarget = await realpath(target).catch(() => target)

        if (existing === resolvedTarget) return

        await rm(link, { recursive: true, force: true })
    }

    await symlink(
        target,
        link,
        process.platform === 'win32' ? 'junction' : 'dir'
    )
}

export async function pathExists(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null)) !== null
}

const VALIDATE_SCRIPT = `import process from 'node:process'

const name = process.argv[2]
const entry = process.argv[3]

function isPlugin(value) {
    if (typeof value !== 'object' || value === null) return false
    if (!('manifest' in value) || !('setup' in value)) return false

    const manifest = value.manifest

    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        typeof manifest.id !== 'string' ||
        typeof manifest.configSchema !== 'object' ||
        manifest.configSchema === null ||
        typeof manifest.configSchema.safeParse !== 'function' ||
        typeof value.setup !== 'function'
    ) {
        return false
    }

    if (
        manifest.dependencies !== undefined &&
        (!Array.isArray(manifest.dependencies) ||
            manifest.dependencies.some((item) => typeof item !== 'string'))
    ) {
        return false
    }

    return true
}

function collect(value, result) {
    if (Array.isArray(value)) {
        for (const item of value) collect(item, result)
        return
    }

    if (isPlugin(value)) {
        result.push(value)
        return
    }

    if (
        typeof value === 'object' &&
        value !== null &&
        'plugins' in value &&
        Array.isArray(value.plugins)
    ) {
        for (const item of value.plugins) collect(item, result)
    }
}

if (!name) {
    console.error('missing package name')
    process.exit(2)
}

if (!entry) {
    console.error('missing package entry')
    process.exit(2)
}

let imported

try {
    imported = await import(entry)
} catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(3)
}

const found = []

if (typeof imported === 'object' && imported !== null) {
    for (const candidate of [imported.default, imported.plugin, imported.plugins]) {
        collect(candidate, found)
    }
}

if (found.length === 0) {
    console.error('package does not export a JsBot plugin (default / plugin / plugins)')
    process.exit(4)
}

const unique = found.filter((plugin, index) => found.indexOf(plugin) === index)

console.log(
    '__JSBOT_PLUGIN__' +
        JSON.stringify(
            unique.map((plugin) => ({
                id: plugin.manifest.id,
                version:
                    typeof plugin.manifest.version === 'string'
                        ? plugin.manifest.version
                        : '0.0.0',
                dependencies: Array.isArray(plugin.manifest.dependencies)
                    ? plugin.manifest.dependencies.filter(
                          (item) => typeof item === 'string'
                      )
                    : [],
            }))
        )
)
`
