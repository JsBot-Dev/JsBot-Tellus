import type { InstalledPackageRecord, InstallState } from '../install-dir.js'
import { pathExists } from '../install-dir.js'
import type { ValidatedPlugin } from '../install-validate.js'
import { ID_PATTERN, InstallerError } from './support.js'

export function checkPlugins(
    packageName: string,
    plugins: ValidatedPlugin[],
    state: InstallState,
    reservedIds: () => ReadonlySet<string>
): void {
    const ownIds = new Set(state.packages[packageName]?.pluginIds ?? [])
    const ids = new Set<string>()
    const taken = new Set<string>()

    for (const id of reservedIds()) {
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

    const reserved = reservedIds()
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

export function resolveTarget(target: string, state: InstallState): string {
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

export async function assertTargetAvailable(
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
