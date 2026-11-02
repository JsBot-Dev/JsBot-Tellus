import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fg from 'fast-glob'
import type { Logger } from '../logging/logger.js'
import { collectPluginExports } from './exports.js'
import { readJsonFile } from './install-dir.js'
import { NpmCliRunner, type NpmRunner } from './npm-runner.js'
import type { AnyPluginDefinition } from './types.js'

type LoaderLogger = Pick<Logger, 'warn' | 'error'> & {
    info?: Logger['info'] | undefined
}

export interface LocalPluginLoaderOptions {
    /** Rebuild local plugins that have a build script on every load. Defaults to true. */
    autoBuild?: boolean | undefined
    /** Timeout for a single local plugin build. Defaults to 120 seconds. */
    buildTimeoutMs?: number | undefined
    /** npm runner override, mainly for tests. */
    runner?: NpmRunner | undefined
}

const DEFAULT_BUILD_TIMEOUT_MS = 120_000

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function directoryExists(path: string): Promise<boolean> {
    const info = await stat(path).catch(() => null)

    return info?.isDirectory() ?? false
}

async function readBuildScript(directory: string): Promise<string | undefined> {
    const manifest = await readJsonFile(join(directory, 'package.json')).catch(
        () => undefined
    )

    if (!isRecord(manifest) || !isRecord(manifest['scripts'])) {
        return undefined
    }

    const build = manifest['scripts']['build']

    return typeof build === 'string' && build.trim().length > 0
        ? build
        : undefined
}

type BuildOutcome = 'built' | 'missing-node-modules' | 'failed'

async function buildLocalPlugin(
    directory: string,
    name: string,
    logger: LoaderLogger | undefined,
    runner: NpmRunner,
    timeoutMs: number
): Promise<BuildOutcome> {
    if (!(await directoryExists(join(directory, 'node_modules')))) {
        logger?.warn(
            `cannot build local plugin ${name}: node_modules is missing; run npm install --prefix ${directory}`
        )
        return 'missing-node-modules'
    }

    logger?.info?.(`building local plugin ${name}`)

    try {
        await runner.run(['run', 'build'], {
            cwd: directory,
            timeoutMs,
        })
    } catch (error) {
        logger?.error(`failed to build local plugin ${name}`, error)
        return 'failed'
    }

    logger?.info?.(`built local plugin ${name}`)

    return 'built'
}

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
            const info = await stat(file).catch(() => null)
            const url = pathToFileURL(file)

            if (info !== null) {
                url.searchParams.set('v', String(info.mtimeMs))
            }

            imported = await import(url.href)
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

export async function loadLocalPlugins(
    root: string,
    logger?: LoaderLogger | undefined,
    options: LocalPluginLoaderOptions = {}
): Promise<AnyPluginDefinition[]> {
    const absolute = resolve(root)
    const info = await stat(absolute).catch(() => null)

    if (!info?.isDirectory()) return []

    const entries = (await readdir(absolute, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name)
    )
    const plugins: AnyPluginDefinition[] = []

    const autoBuild = options.autoBuild !== false
    const runner = options.runner ?? new NpmCliRunner()
    const timeoutMs = options.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        if (entry.name === 'node_modules') continue

        const directory = join(absolute, entry.name)
        const dist = join(directory, 'dist')
        const hasBuildScript = (await readBuildScript(directory)) !== undefined
        let distInfo = await stat(dist).catch(() => null)

        if (autoBuild && hasBuildScript) {
            const outcome = await buildLocalPlugin(
                directory,
                entry.name,
                logger,
                runner,
                timeoutMs
            )

            distInfo = await stat(dist).catch(() => null)

            if (!distInfo?.isDirectory()) {
                const reason =
                    outcome === 'built'
                        ? 'build finished but dist directory not found'
                        : outcome === 'missing-node-modules'
                          ? 'node_modules is missing and dist directory not found'
                          : 'build failed and dist directory not found'

                logger?.warn(`skipping local plugin ${entry.name}: ${reason}`)
                continue
            }

            if (outcome !== 'built') {
                logger?.warn(
                    `using existing dist for local plugin ${entry.name}: rebuild failed`
                )
            }
        } else if (!distInfo?.isDirectory()) {
            logger?.warn(
                hasBuildScript
                    ? `skipping local plugin ${entry.name}: dist directory not found and automatic build is disabled`
                    : `skipping local plugin ${entry.name}: dist directory not found and package.json has no build script`
            )
            continue
        }

        plugins.push(...(await loadPluginsFromDirectory(dist, logger)))
    }

    return plugins
}
