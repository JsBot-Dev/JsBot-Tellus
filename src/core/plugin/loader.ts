import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fg from 'fast-glob'
import { collectPluginExports } from './exports.js'
import type { AnyPluginDefinition } from './types.js'

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
        plugins.push(...collectPluginExports(imported, file))
    }

    return plugins
}
