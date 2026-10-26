import type { EventType, PluginMiddleware } from '../plugin/types.js'

export interface MiddlewareRegistration {
    pluginId: string
    name?: string | undefined
    eventTypes: EventType[]
    priority: number
    handler: PluginMiddleware
}

export class MiddlewareRegistry {
    private registrations: MiddlewareRegistration[] = []

    register(registration: MiddlewareRegistration): () => void {
        this.registrations.push(registration)

        let disposed = false

        return () => {
            if (disposed) return

            disposed = true
            this.registrations = this.registrations.filter(
                (item) => item !== registration
            )
        }
    }

    list(eventType: EventType): MiddlewareRegistration[] {
        return this.registrations
            .filter((item) => item.eventTypes.includes(eventType))
            .sort((a, b) => b.priority - a.priority)
    }

    removePlugin(pluginId: string): void {
        this.registrations = this.registrations.filter(
            (item) => item.pluginId !== pluginId
        )
    }
}
