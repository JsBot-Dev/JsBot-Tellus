import type { AnyPluginDefinition } from './types.js'

export function isPluginDefinition(
    value: unknown
): value is AnyPluginDefinition {
    if (typeof value !== 'object' || value === null) return false

    if (!('manifest' in value) || !('setup' in value)) return false

    const manifest = value.manifest

    if (typeof manifest !== 'object' || manifest === null) return false

    const configSchema = (manifest as Record<string, unknown>)['configSchema']
    const dependencies = (manifest as Record<string, unknown>)['dependencies']

    return (
        'id' in manifest &&
        typeof manifest.id === 'string' &&
        typeof configSchema === 'object' &&
        configSchema !== null &&
        typeof (configSchema as { safeParse?: unknown }).safeParse ===
            'function' &&
        (dependencies === undefined ||
            (Array.isArray(dependencies) &&
                dependencies.every((item) => typeof item === 'string'))) &&
        typeof value.setup === 'function'
    )
}

export interface CollectPluginExportOptions {
    onInvalid?: ((message: string) => void) | undefined
}

function collect(
    value: unknown,
    source: string,
    result: AnyPluginDefinition[],
    options: CollectPluginExportOptions
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collect(item, source, result, options)
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
        collect(value.plugins, source, result, options)
        return
    }

    if (value !== undefined && value !== null) {
        options.onInvalid?.(`invalid plugin export: ${source}`)
    }
}

export function collectPluginExports(
    imported: unknown,
    source: string,
    options: CollectPluginExportOptions = {}
): AnyPluginDefinition[] {
    if (typeof imported !== 'object' || imported === null) return []

    const record = imported as Record<string, unknown>
    const plugins: AnyPluginDefinition[] = []

    for (const candidate of [
        record['default'],
        record['plugin'],
        record['plugins'],
    ]) {
        collect(candidate, source, plugins, options)
    }

    return plugins.filter((plugin, index) => plugins.indexOf(plugin) === index)
}
