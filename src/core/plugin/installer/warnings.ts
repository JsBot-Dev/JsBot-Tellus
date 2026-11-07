import type { InstalledPackageRecord, InstallState } from '../install-dir.js'

export function configuredWarnings(
    pluginIds: readonly string[],
    configured: ReadonlySet<string>,
    configPathOf?: ((id: string) => string) | undefined
): string[] {
    return pluginIds
        .filter((id) => configured.has(id))
        .map((id) => {
            const path = configPathOf?.(id) ?? `${id}.jsonc`

            return `插件 ${id} 的配置文件 ${path} 仍然存在，重启后会忽略；如需清理请删除该文件`
        })
}

export function removalWarnings(
    packageName: string,
    record: InstalledPackageRecord | undefined,
    state: InstallState,
    configured: ReadonlySet<string>,
    configPathOf?: ((id: string) => string) | undefined
): string[] {
    return [
        ...configuredWarnings(
            record?.pluginIds ?? [],
            configured,
            configPathOf
        ),
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
