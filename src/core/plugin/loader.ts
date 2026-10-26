import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fg from 'fast-glob'
import type { AnyPluginDefinition } from './types.js'

function isPluginDefinition(value: unknown): value is AnyPluginDefinition {
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
    filePath: string,
    result: AnyPluginDefinition[]
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collect(item, filePath, result)
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
        collect(value.plugins, filePath, result)
        return
    }

    if (value !== undefined && value !== null) {
        throw new Error(`invalid plugin export: ${filePath}`)
    }
}

export async function loadPluginsFromDirectory(
    directory: string
): Promise<AnyPluginDefinition[]> {
    const absolute = resolve(directory)
    const info = await stat(absolute).catch(() => null)

    if (!info?.isDirectory()) {
        throw new Error(`plugin directory not found: ${absolute}`)
    }

    const files = await fg('**/*.{js,mjs,cjs,ts,mts,cts}', {
        cwd: absolute,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts', '**/node_modules/**'],
    })

    const plugins: AnyPluginDefinition[] = []

    for (const file of files.sort()) {
        const imported: unknown = await import(pathToFileURL(file).href)

        if (typeof imported !== 'object' || imported === null) {
            continue
        }

        const record = imported as Record<string, unknown>
        const candidates = [
            record['default'],
            record['plugin'],
            record['plugins'],
        ]

        for (const candidate of candidates) {
            collect(candidate, file, plugins)
        }
    }

    return plugins
}
