import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fg from 'fast-glob'
import type { Logger } from '../logging/logger.js'
import { collectPluginExports } from './exports.js'
import type { AnyPluginDefinition } from './types.js'

type LoaderLogger = Pick<Logger, 'warn' | 'error'>

export async function loadPluginsFromDirectory(
    directory: string,
    logger?: LoaderLogger | undefined
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
    const invalid: string[] = []

    for (const file of files.sort()) {
        let imported: unknown

        try {
            imported = await import(pathToFileURL(file).href)
        } catch (error) {
            logger?.error(`failed to import plugin file: ${file}`, error)
            invalid.push(
                `failed to import ${file}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            )
            continue
        }

        plugins.push(
            ...collectPluginExports(imported, file, {
                onInvalid: (message) => {
                    logger?.warn(message)
                    invalid.push(message)
                },
            })
        )
    }

    if (plugins.length === 0 && invalid.length > 0) {
        throw new Error(invalid[0])
    }

    return plugins
}
