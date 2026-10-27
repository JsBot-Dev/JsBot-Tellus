import type {
    CommandGroupRegistrar,
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

export interface CommandGroupRegistration {
    pluginId: string
    name: string
    aliases: string[]
    prefixes: string[]
    permission: Permission
    description?: string | undefined
    handler?: CommandHandler | undefined
}

export interface RegisteredCommand {
    registration: CommandRegistration
    match: CommandMatch
}

interface GroupChild {
    name: string
    description?: string | undefined
}

interface GroupScope {
    registrar: CommandGroupRegistrar
    disposeAll: () => void
    track: (dispose: () => void, cleanup?: () => void) => () => void
}

function normalizeSegment(label: string, value: string): string {
    const trimmed = value.trim()

    if (!trimmed) {
        throw new Error(`${label} must not be empty`)
    }

    if (/\s/.test(trimmed)) {
        throw new Error(
            `${label} must be a single segment; use commands.group() for multi-level commands`
        )
    }

    return trimmed
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const value of values) {
        const key = value.toLowerCase()

        if (seen.has(key)) continue

        seen.add(key)
        result.push(value)
    }

    return result
}

function groupBases(name: string, aliases: string[]): string[] {
    return uniqueStrings([
        normalizeSegment('group name', name),
        ...aliases.map((alias) => normalizeSegment('group alias', alias)),
    ])
}

function composedBases(
    parentBases: string[],
    name: string,
    aliases: string[],
    kind: 'command' | 'group'
): string[] {
    const variants = uniqueStrings([
        normalizeSegment(`${kind} name`, name),
        ...aliases.map((alias) => normalizeSegment(`${kind} alias`, alias)),
    ])
    const bases: string[] = []
    const seen = new Set<string>()

    for (const parent of parentBases) {
        for (const variant of variants) {
            const path = `${parent} ${variant}`
            const key = path.toLowerCase()

            if (seen.has(key)) continue

            seen.add(key)
            bases.push(path)
        }
    }

    return bases
}

function createGroupUsageHandler(children: GroupChild[]): CommandHandler {
    return async (_event, context, match) => {
        const root = `${match.prefix}${match.command}`
        const names = children.map((child) => child.name)
        const lines = [
            names.length > 0
                ? `用法：${root} <${names.join('|')}>`
                : `用法：${root}`,
        ]

        for (const child of children) {
            const command = `${root} ${child.name}`

            lines.push(
                child.description !== undefined
                    ? `${command} - ${child.description}`
                    : command
            )
        }

        await context.send(lines.join('\n'))
    }
}

export class CommandRegistry {
    private readonly index = new Map<string, Map<string, CommandRegistration>>()
    private readonly registrations = new Set<CommandRegistration>()
    private readonly byPlugin = new Map<string, Set<CommandRegistration>>()

    register(registration: CommandRegistration): () => void {
        const name = normalizeSegment('command name', registration.name)
        const aliases = uniqueStrings(
            registration.aliases.map((alias) =>
                normalizeSegment('command alias', alias)
            )
        ).filter((alias) => alias.toLowerCase() !== name.toLowerCase())
        const normalized: CommandRegistration = {
            ...registration,
            name,
            aliases,
        }

        return this.insert(normalized, [name, ...aliases])
    }

    group(
        registration: CommandGroupRegistration,
        setup: (group: CommandGroupRegistrar) => void
    ): () => void {
        const prefixes = uniqueStrings(registration.prefixes)
        const bases = groupBases(registration.name, registration.aliases)
        const children: GroupChild[] = []
        const scope = this.createGroupScope(
            registration.pluginId,
            bases,
            prefixes,
            registration.permission,
            children
        )

        try {
            setup(scope.registrar)

            const dispose = this.registerGroupRoot(
                registration.pluginId,
                bases,
                prefixes,
                registration.permission,
                registration.description,
                registration.handler,
                children
            )

            scope.track(dispose)
        } catch (error) {
            scope.disposeAll()
            throw error
        }

        return scope.disposeAll
    }

    removePlugin(pluginId: string): void {
        const registrations = this.byPlugin.get(pluginId)

        if (!registrations) return

        for (const registration of [...registrations]) {
            const names = [registration.name, ...registration.aliases].map(
                (name) => name.toLowerCase()
            )

            for (const prefix of registration.prefixes) {
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

            const tokens = [...text.matchAll(/\S+/g)]

            if (tokens.length === 0) continue

            for (let count = tokens.length; count >= 1; count -= 1) {
                const matched = tokens.slice(0, count)
                const first = matched[0]
                const last = matched[matched.length - 1]

                if (!first || !last) continue

                const key = matched
                    .map((token) => token[0])
                    .join(' ')
                    .toLowerCase()
                const registration = this.index.get(prefix)?.get(key)

                if (!registration) continue

                const start = first.index ?? 0
                const end = (last.index ?? 0) + last[0].length

                return {
                    registration,
                    match: {
                        command: text
                            .slice(start, end)
                            .replace(/\s+/g, ' ')
                            .trim(),
                        prefix,
                        args: tokens.slice(count).map((token) => token[0]),
                        rest: text.slice(end).trim(),
                    },
                }
            }
        }

        return null
    }

    private insert(
        registration: CommandRegistration,
        paths: string[]
    ): () => void {
        const prefixes = uniqueStrings(registration.prefixes)
        const names = uniqueStrings(paths)

        for (const prefix of prefixes) {
            for (const name of names) {
                const existing = this.index.get(prefix)?.get(name.toLowerCase())

                if (existing) {
                    throw new Error(`command conflict: ${prefix}${name}`)
                }
            }
        }

        for (const prefix of prefixes) {
            const bucket =
                this.index.get(prefix) ?? new Map<string, CommandRegistration>()

            for (const name of names) {
                bucket.set(name.toLowerCase(), registration)
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
                    if (bucket.get(name.toLowerCase()) === registration) {
                        bucket.delete(name.toLowerCase())
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

    private createGroupScope(
        pluginId: string,
        bases: string[],
        prefixes: string[],
        permission: Permission,
        children: GroupChild[]
    ): GroupScope {
        const disposers: Array<() => void> = []
        let disposed = false

        const track = (
            dispose: () => void,
            cleanup?: () => void
        ): (() => void) => {
            let done = false

            const tracked = (): void => {
                if (done) return

                done = true
                cleanup?.()
                dispose()
            }

            disposers.push(tracked)

            return tracked
        }

        const disposeAll = (): void => {
            if (disposed) return

            disposed = true

            for (const dispose of disposers.splice(0).reverse()) {
                dispose()
            }
        }

        const registrar: CommandGroupRegistrar = {
            register: (options, handler) => {
                const childBases = composedBases(
                    bases,
                    options.name,
                    options.aliases ?? [],
                    'command'
                )
                const name = childBases[0]

                if (!name) {
                    throw new Error('command name must not be empty')
                }

                const registration: CommandRegistration = {
                    pluginId,
                    name,
                    aliases: childBases.slice(1),
                    prefixes: options.prefixes ?? prefixes,
                    permission: options.permission ?? permission,
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                    handler,
                }
                const dispose = this.insert(registration, childBases)
                const record: GroupChild = {
                    name: options.name.trim(),
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                }

                children.push(record)

                return track(dispose, () => {
                    const index = children.indexOf(record)

                    if (index >= 0) {
                        children.splice(index, 1)
                    }
                })
            },

            group: (options, nestedSetup) => {
                const nestedBases = composedBases(
                    bases,
                    options.name,
                    options.aliases ?? [],
                    'group'
                )
                const nestedPrefixes = options.prefixes ?? prefixes
                const nestedPermission = options.permission ?? permission
                const nestedChildren: GroupChild[] = []
                const nestedScope = this.createGroupScope(
                    pluginId,
                    nestedBases,
                    nestedPrefixes,
                    nestedPermission,
                    nestedChildren
                )

                try {
                    nestedSetup(nestedScope.registrar)

                    const dispose = this.registerGroupRoot(
                        pluginId,
                        nestedBases,
                        nestedPrefixes,
                        nestedPermission,
                        options.description,
                        options.handler,
                        nestedChildren
                    )

                    nestedScope.track(dispose)
                } catch (error) {
                    nestedScope.disposeAll()
                    throw error
                }

                const record: GroupChild = {
                    name: options.name.trim(),
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                }

                children.push(record)

                return track(nestedScope.disposeAll, () => {
                    const index = children.indexOf(record)

                    if (index >= 0) {
                        children.splice(index, 1)
                    }
                })
            },
        }

        return { registrar, disposeAll, track }
    }

    private registerGroupRoot(
        pluginId: string,
        bases: string[],
        prefixes: string[],
        permission: Permission,
        description: string | undefined,
        handler: CommandHandler | undefined,
        children: GroupChild[]
    ): () => void {
        const name = bases[0]

        if (!name) {
            throw new Error('group name must not be empty')
        }

        const registration: CommandRegistration = {
            pluginId,
            name,
            aliases: bases.slice(1),
            prefixes,
            permission,
            ...(description !== undefined ? { description } : {}),
            handler: handler ?? createGroupUsageHandler(children),
        }

        return this.insert(registration, bases)
    }
}
