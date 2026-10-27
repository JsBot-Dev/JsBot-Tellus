import type { AnyPluginDefinition } from './types.js'

export function isPluginDefinition(
    value: unknown
): value is AnyPluginDefinition {
    if (typeof value !== 'object' || value === null) return false

    if (!('manifest' in value) || !('setup' in value)) return false

    const manifest = value.manifest

    return (
        typeof manifest === 'object' &&
        manifest !== null &&
        'id' in manifest &&
        typeof manifest.id === 'string' &&
        'configSchema' in manifest &&
        typeof manifest.configSchema === 'object' &&
        manifest.configSchema !== null &&
        typeof value.setup === 'function'
    )
}

function collect(
    value: unknown,
    source: string,
    result: AnyPluginDefinition[]
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collect(item, source, result)
        }

        return
    }

    if (isPluginDefinition(value)) {
        result.push(value)
        return
    }

    if (
        typeof value === 'object' &&
        value !== null &&
        'plugins' in value &&
        Array.isArray(value.plugins)
    ) {
        collect(value.plugins, source, result)
        return
    }

    if (value !== undefined && value !== null) {
        throw new Error(`invalid plugin export: ${source}`)
    }
}

export function collectPluginExports(
    imported: unknown,
    source: string
): AnyPluginDefinition[] {
    if (typeof imported !== 'object' || imported === null) return []

    const record = imported as Record<string, unknown>
    const plugins: AnyPluginDefinition[] = []

    for (const candidate of [
        record['default'],
        record['plugin'],
        record['plugins'],
    ]) {
        collect(candidate, source, plugins)
    }

    return plugins.filter((plugin, index) => plugins.indexOf(plugin) === index)
}
