import type {
    CommandHandler,
    CommandInfo,
    CommandMatch,
} from '../plugin/types.js'
import type { Permission } from '../security/permission.js'

export interface CommandRegistration {
    pluginId: string
    name: string
    aliases: string[]
    prefixes: string[]
    permission: Permission
    description?: string | undefined
    handler: CommandHandler
}

export interface RegisteredCommand {
    registration: CommandRegistration
    match: CommandMatch
}

export class CommandRegistry {
    private readonly index = new Map<string, Map<string, CommandRegistration>>()
    private readonly registrations = new Set<CommandRegistration>()
    private readonly byPlugin = new Map<string, Set<CommandRegistration>>()

    register(registration: CommandRegistration): () => void {
        const names = [
            ...new Set(
                [registration.name, ...registration.aliases].map((name) =>
                    name.toLowerCase()
                )
            ),
        ]
        const prefixes = [...new Set(registration.prefixes)]

        for (const prefix of prefixes) {
            for (const name of names) {
                const existing = this.index.get(prefix)?.get(name)

                if (existing) {
                    throw new Error(`command conflict: ${prefix}${name}`)
                }
            }
        }

        for (const prefix of prefixes) {
            const bucket =
                this.index.get(prefix) ?? new Map<string, CommandRegistration>()

            for (const name of names) {
                bucket.set(name, registration)
            }

            this.index.set(prefix, bucket)
        }

        this.registrations.add(registration)

        const pluginSet =
            this.byPlugin.get(registration.pluginId) ??
            new Set<CommandRegistration>()
        pluginSet.add(registration)
        this.byPlugin.set(registration.pluginId, pluginSet)

        let disposed = false

        return () => {
            if (disposed) return

            disposed = true

            for (const prefix of prefixes) {
                const bucket = this.index.get(prefix)

                if (!bucket) continue

                for (const name of names) {
                    if (bucket.get(name) === registration) {
                        bucket.delete(name)
                    }
                }

                if (bucket.size === 0) {
                    this.index.delete(prefix)
                }
            }

            this.registrations.delete(registration)
            pluginSet.delete(registration)

            if (pluginSet.size === 0) {
                this.byPlugin.delete(registration.pluginId)
            }
        }
    }

    removePlugin(pluginId: string): void {
        const registrations = this.byPlugin.get(pluginId)

        if (!registrations) return

        for (const registration of [...registrations]) {
            const prefixes = registration.prefixes
            const names = [registration.name, ...registration.aliases].map(
                (name) => name.toLowerCase()
            )

            for (const prefix of prefixes) {
                const bucket = this.index.get(prefix)

                if (!bucket) continue

                for (const name of names) {
                    if (bucket.get(name) === registration) {
                        bucket.delete(name)
                    }
                }

                if (bucket.size === 0) {
                    this.index.delete(prefix)
                }
            }

            this.registrations.delete(registration)
        }

        this.byPlugin.delete(pluginId)
    }

    list(): ReadonlyArray<CommandInfo> {
        return [...this.registrations]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((registration) => ({
                name: registration.name,
                aliases: [...registration.aliases],
                permission: registration.permission,
                ...(registration.description !== undefined
                    ? { description: registration.description }
                    : {}),
                pluginId: registration.pluginId,
            }))
    }

    match(rawMessage: string): RegisteredCommand | null {
        const raw = rawMessage.trim()

        if (!raw) return null

        const prefixes = [...this.index.keys()].sort(
            (a, b) => b.length - a.length
        )

        for (const prefix of prefixes) {
            if (prefix && !raw.startsWith(prefix)) continue

            const text = prefix ? raw.slice(prefix.length).trimStart() : raw

            if (!text) continue

            const [head = '', ...args] = text.split(/\s+/)
            const registration = this.index.get(prefix)?.get(head.toLowerCase())

            if (!registration) continue

            return {
                registration,
                match: {
                    command: head,
                    prefix,
                    args,
                    rest: text.slice(head.length).trim(),
                },
            }
        }

        return null
    }
}
