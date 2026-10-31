import type { InstalledPackageRecord, InstallState } from '../install-dir.js'

export function configuredWarnings(
    pluginIds: readonly string[],
    configured: ReadonlySet<string>
): string[] {
    return pluginIds
        .filter((id) => configured.has(id))
        .map(
            (id) =>
                `配置里的 plugins.${id} 仍然存在，重启前请删除，否则会因未知插件 ID 启动失败`
        )
}

export function removalWarnings(
    packageName: string,
    record: InstalledPackageRecord | undefined,
    state: InstallState,
    configured: ReadonlySet<string>
): string[] {
    return [
        ...configuredWarnings(record?.pluginIds ?? [], configured),
        ...dependentWarnings(packageName, record, state),
    ]
}

export function dependentWarnings(
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
