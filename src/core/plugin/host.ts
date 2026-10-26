import type { PluginEnvelope } from '../config/schema.js'
import { formatConfigIssues } from '../config/schema.js'
import type { Router } from '../dispatch/router.js'
import type { Logger } from '../logging/logger.js'
import type { PluginGate } from './gating.js'
import type {
    AnyPluginDefinition,
    PluginContext,
    PluginStatusEntry,
} from './types.js'

export class PluginConfigError extends Error {
    constructor(pluginId: string, message: string) {
        super(`invalid config for plugin ${pluginId}\n${message}`)
        this.name = 'PluginConfigError'
    }
}

interface LoadedPlugin {
    definition: AnyPluginDefinition
    state: unknown
    stopped: boolean
}

export interface PluginHostDeps {
    definitions: AnyPluginDefinition[]
    configs: Record<string, PluginEnvelope>
    gate: PluginGate
    router: Router
    logger: Logger
    createContext: (
        definition: AnyPluginDefinition,
        config: unknown
    ) => PluginContext<unknown>
}

export function stripPluginEnvelope(
    raw: PluginEnvelope
): Record<string, unknown> {
    const {
        enabled: _enabled,
        private: _private,
        groups: _groups,
        ...options
    } = raw

    return options
}

export function sortPlugins(
    definitions: AnyPluginDefinition[]
): AnyPluginDefinition[] {
    const byId = new Map<string, AnyPluginDefinition>()

    for (const definition of definitions) {
        const id = definition.manifest.id

        if (byId.has(id)) {
            throw new Error(`duplicate plugin id: ${id}`)
        }

        byId.set(id, definition)
    }

    const result: AnyPluginDefinition[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (definition: AnyPluginDefinition): void => {
        const id = definition.manifest.id

        if (visited.has(id)) return

        if (visiting.has(id)) {
            throw new Error(`plugin dependency cycle: ${id}`)
        }

        visiting.add(id)

        for (const dependency of definition.manifest.dependencies ?? []) {
            const target = byId.get(dependency)

            if (!target) {
                throw new Error(`plugin ${id} requires missing ${dependency}`)
            }

            visit(target)
        }

        visiting.delete(id)
        visited.add(id)
        result.push(definition)
    }

    const byPriority = [...definitions].sort(
        (a, b) => (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0)
    )

    for (const definition of byPriority) visit(definition)

    return result
}

export class PluginHost {
    private loaded: LoadedPlugin[] = []
    private stopPromise: Promise<void> | null = null

    constructor(private readonly deps: PluginHostDeps) {}

    async setup(): Promise<void> {
        const definitions = sortPlugins(this.deps.definitions)
        const known = new Set(
            definitions.map((definition) => definition.manifest.id)
        )

        for (const id of Object.keys(this.deps.configs)) {
            if (!known.has(id)) {
                throw new Error(`unknown plugin id: ${id}`)
            }
        }

        try {
            for (const definition of definitions) {
                const id = definition.manifest.id

                if (!this.deps.gate.isPluginEnabled(id)) {
                    this.deps.logger.debug(`plugin ${id} disabled`)
                    continue
                }

                const raw = this.deps.configs[id] ?? {}
                const options = stripPluginEnvelope(raw)
                const result =
                    definition.manifest.configSchema.safeParse(options)

                if (!result.success) {
                    throw new PluginConfigError(
                        id,
                        formatConfigIssues(result.error, `plugins.${id}`)
                    )
                }

                const context = this.deps.createContext(definition, result.data)

                let state: unknown

                try {
                    state = await definition.setup(context)
                } catch (error) {
                    this.deps.router.removePlugin(id)
                    throw error
                }

                this.loaded.push({
                    definition,
                    state,
                    stopped: false,
                })

                this.deps.logger.info(`plugin ${id} setup`)
            }
        } catch (error) {
            await this.stop()
            throw error
        }
    }

    async start(): Promise<void> {
        try {
            for (const plugin of this.loaded) {
                await plugin.definition.start?.(plugin.state)
            }
        } catch (error) {
            await this.stop()
            throw error
        }
    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise

        this.stopPromise = this.doStop()

        return this.stopPromise
    }

    listStatus(): PluginStatusEntry[] {
        const loaded = new Set(
            this.loaded.map((plugin) => plugin.definition.manifest.id)
        )

        return this.deps.definitions
            .map((definition) => ({
                id: definition.manifest.id,
                enabled: this.deps.gate.isPluginEnabled(definition.manifest.id),
                loaded: loaded.has(definition.manifest.id),
            }))
            .sort((a, b) => a.id.localeCompare(b.id))
    }

    private async doStop(): Promise<void> {
        for (const plugin of [...this.loaded].reverse()) {
            await this.safeStop(plugin)
        }

        this.loaded = []
    }

    private async safeStop(plugin: LoadedPlugin): Promise<void> {
        const id = plugin.definition.manifest.id

        if (plugin.stopped) return

        plugin.stopped = true

        try {
            await plugin.definition.stop?.(plugin.state)
        } catch (error) {
            this.deps.logger.error(`plugin ${id} stop failed`, error)
        } finally {
            this.deps.router.removePlugin(id)
        }
    }
}
