import type { SnowLumaEvent } from '@snowluma/sdk'
import type { PluginEnvelope } from '../config/schema.js'
import type { AnyPluginDefinition } from './types.js'

export class PluginGate {
    private readonly defaults = new Map<string, boolean>()
    private readonly configs: Record<string, PluginEnvelope>

    constructor(
        definitions: AnyPluginDefinition[],
        configs: Record<string, PluginEnvelope>
    ) {
        for (const definition of definitions) {
            this.defaults.set(
                definition.manifest.id,
                definition.manifest.defaultEnabled ?? false
            )
        }

        this.configs = configs
    }

    isPluginEnabled(id: string): boolean {
        return this.configs[id]?.enabled ?? this.defaults.get(id) ?? false
    }

    isEnabled(id: string, event: SnowLumaEvent): boolean {
        if (!this.isPluginEnabled(id)) return false

        const groupId = (event as { group_id?: unknown }).group_id

        if (typeof groupId === 'number') {
            const groups = this.configs[id]?.groups

            if (!groups) return true

            if (groups.allow.length > 0) {
                return groups.allow.includes(groupId)
            }

            if (groups.deny.length > 0) {
                return !groups.deny.includes(groupId)
            }

            return true
        }

        return this.configs[id]?.private ?? true
    }
}
