import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Logger } from '../logging/logger.js'
import { collectPluginExports } from './exports.js'
import {
    CORE_PACKAGE_NAME,
    ensureCoreLink,
    packageDir,
    pathExists,
    readDependencies,
    readJsonFile,
} from './install-dir.js'
import type { AnyPluginDefinition } from './types.js'

export interface LoadedInstalledPlugins {
    plugins: AnyPluginDefinition[]
    byPackage: Map<string, string[]>
}

function pickCondition(value: unknown): string | undefined {
    if (typeof value === 'string') return value

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = pickCondition(item)
            if (found !== undefined) return found
        }

        return undefined
    }

    if (typeof value !== 'object' || value === null) return undefined

    const record = value as Record<string, unknown>

    for (const key of ['import', 'node', 'default']) {
        if (key in record) {
            const found = pickCondition(record[key])
            if (found !== undefined) return found
        }
    }

    for (const [key, item] of Object.entries(record)) {
        if (key === 'types' || key === 'require') continue

        const found = pickCondition(item)
        if (found !== undefined) return found
    }

    return undefined
}

export function packageEntry(
    directory: string,
    manifest: Record<string, unknown>
): string {
    const exportsValue = manifest['exports']
    let entry: string | undefined

    if (exportsValue !== undefined) {
        if (
            typeof exportsValue === 'object' &&
            exportsValue !== null &&
            !Array.isArray(exportsValue)
        ) {
            const record = exportsValue as Record<string, unknown>

            if ('.' in record) {
                entry = pickCondition(record['.'])
            } else if (
                Object.keys(record).some((key) => !key.startsWith('.'))
            ) {
                entry = pickCondition(record)
            }
        } else {
            entry = pickCondition(exportsValue)
        }

        if (entry === undefined) {
            throw new Error('package.json 的 exports 没有定义根入口')
        }
    } else if (typeof manifest['main'] === 'string') {
        entry = manifest['main']
    } else {
        entry = './index.js'
    }

    return join(directory, entry)
}

export async function loadInstalledPlugins(
    directory: string,
    logger: Logger
): Promise<LoadedInstalledPlugins> {
    const result: LoadedInstalledPlugins = {
        plugins: [],
        byPackage: new Map(),
    }

    if (!(await pathExists(join(directory, 'package.json')))) {
        return result
    }

    await ensureCoreLink(directory)

    const dependencies = await readDependencies(directory)
    const names = Object.keys(dependencies)
        .filter((name) => name !== CORE_PACKAGE_NAME)
        .sort()

    for (const name of names) {
        const location = packageDir(directory, name)
        const manifest = await readJsonFile(join(location, 'package.json'))

        if (typeof manifest !== 'object' || manifest === null) {
            logger.warn(`installed plugin package missing: ${name}`)
            continue
        }

        let plugins: AnyPluginDefinition[]

        try {
            const entry = packageEntry(
                location,
                manifest as Record<string, unknown>
            )
            const imported: unknown = await import(pathToFileURL(entry).href)
            plugins = collectPluginExports(imported, entry)
        } catch (error) {
            logger.error(
                `failed to load installed plugin package: ${name}`,
                error
            )
            continue
        }

        if (plugins.length === 0) {
            logger.warn(`installed package exported no plugin: ${name}`)
            continue
        }

        result.byPackage.set(
            name,
            plugins.map((plugin) => plugin.manifest.id)
        )
        result.plugins.push(...plugins)
    }

    return result
}
