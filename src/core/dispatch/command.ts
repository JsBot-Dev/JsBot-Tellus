import type { OneBotMessageEvent } from '@snowluma/sdk'
import {
    compileCommandParams,
    type CommandParamArgs,
    type CompiledCommandParams,
} from '../plugin/command-params.js'
import type {
    CommandEventOf,
    CommandGroupOptions,
    CommandGroupRegistrar,
    CommandHandler,
    CommandInfo,
    CommandMatch,
    CommandOptions,
    MessageType,
    MessageTypeFilter,
} from '../plugin/types.js'
import type { Permission } from '../security/permission.js'

type AnyCommandHandler = CommandHandler<OneBotMessageEvent, any[]>

const DEFAULT_MESSAGE_TYPES: MessageType[] = ['group', 'private']

export function normalizeMessageTypes(
    value: MessageTypeFilter | undefined
): MessageType[] {
    if (value === undefined) return [...DEFAULT_MESSAGE_TYPES]

    const values = typeof value === 'string' ? [value] : value
    const result: MessageType[] = []

    for (const item of values) {
        if (
            (item === 'group' || item === 'private') &&
            !result.includes(item)
        ) {
            result.push(item)
        }
    }

    return result
}

export interface CommandRegistration {
    pluginId: string
    name: string
    aliases: string[]
    prefixes: string[]
    permission: Permission
    messageTypes: MessageType[]
    description?: string | undefined
    params?: string | undefined
    paramsParser?: CompiledCommandParams | undefined
    usage?: string | undefined
    handler: AnyCommandHandler
}

export interface CommandGroupRegistration {
    pluginId: string
    name: string
    aliases: string[]
    prefixes: string[]
    permission: Permission
    messageTypes: MessageType[]
    description?: string | undefined
    params?: string | undefined
    handler?: AnyCommandHandler | undefined
}

export interface RegisteredCommand {
    registration: CommandRegistration
    match: CommandMatch
}

interface CommandNode {
    registration?: CommandRegistration | undefined
    readonly children: Map<string, CommandNode>
}

interface CommandPlacement {
    prefix: string
    segments: string[]
}

interface ParsedPath {
    path: string
    segments: string[]
}

interface GroupChild {
    name: string
    description?: string | undefined
    usage?: string | undefined
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
            `${label} must be a single segment; use '.' for nested command paths and commands.group() for groups`
        )
    }

    return trimmed
}

function parsePath(value: string): ParsedPath {
    const path = value.trim()
    const segments = path.split(/[.\s]+/)

    if (segments.some((segment) => segment.length === 0)) {
        throw new Error(`invalid command path: ${path}`)
    }

    return { path, segments }
}

function isPathSeparator(char: string | undefined): boolean {
    return char === '.' || (char !== undefined && /\s/.test(char))
}

function skipPathSeparators(text: string, start: number): number {
    let position = start

    while (position < text.length && isPathSeparator(text[position])) {
        position += 1
    }

    return position
}

function restStart(text: string, end: number): number {
    let position = end

    while (position < text.length && text[position] === '.') {
        position += 1
    }

    while (position < text.length && /\s/.test(text[position] ?? '')) {
        position += 1
    }

    return position
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

/**
 * Prefixes are matched case-sensitively, so they must be deduplicated the
 * same way. Using `uniqueStrings` here would drop `a` when `A` is registered.
 */
function uniquePrefixes(values: string[]): string[] {
    return [...new Set(values)]
}

const LEADING_REPLY = /^(?:\[CQ:reply(?:,[^\]]*)?\]\s*)+/

function stripLeadingReply(raw: string): string {
    return raw.replace(LEADING_REPLY, '')
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

function createGroupUsageHandler(children: GroupChild[]): AnyCommandHandler {
    return async (_event, context, match) => {
        const root = `${match.prefix}${match.command}`
        const names = children.map((child) => child.name)
        const lines = [
            names.length > 0
                ? `用法：${root} <${names.join('|')}>`
                : `用法：${root}`,
        ]

        for (const child of children) {
            const usage = child.usage !== undefined ? ` ${child.usage}` : ''
            const command = `${root} ${child.name}${usage}`

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
    private readonly trees = new Map<string, CommandNode>()
    private readonly registrations = new Set<CommandRegistration>()
    private readonly byPlugin = new Map<string, Set<CommandRegistration>>()
    private readonly disposers = new Map<CommandRegistration, () => void>()

    register(registration: CommandRegistration): () => void {
        const name = normalizeSegment('command name', registration.name)
        const aliases = uniqueStrings(
            registration.aliases.map((alias) =>
                normalizeSegment('command alias', alias)
            )
        ).filter((alias) => alias.toLowerCase() !== name.toLowerCase())
        const normalized = this.withParams({
            ...registration,
            name,
            aliases,
        })

        return this.insert(normalized, [name, ...aliases])
    }

    group(
        registration: CommandGroupRegistration,
        setup: (group: CommandGroupRegistrar) => void
    ): () => void {
        const prefixes = uniquePrefixes(registration.prefixes)
        const bases = groupBases(registration.name, registration.aliases)
        const children: GroupChild[] = []
        const scope = this.createGroupScope(
            registration.pluginId,
            bases,
            prefixes,
            registration.permission,
            registration.messageTypes,
            children
        )

        try {
            setup(scope.registrar)

            const dispose = this.registerGroupRoot(
                registration.pluginId,
                bases,
                prefixes,
                registration.permission,
                registration.messageTypes,
                registration.description,
                registration.params,
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
            this.disposers.get(registration)?.()
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
                messageTypes: [...registration.messageTypes],
                ...(registration.description !== undefined
                    ? { description: registration.description }
                    : {}),
                ...(registration.usage !== undefined
                    ? { usage: registration.usage }
                    : {}),
                pluginId: registration.pluginId,
            }))
    }

    match(
        rawMessage: string,
        messageType?: MessageType
    ): RegisteredCommand | null {
        const raw = stripLeadingReply(rawMessage.trim()).trim()

        if (!raw) return null

        const prefixes = [...this.trees.keys()].sort(
            (a, b) => b.length - a.length
        )

        for (const prefix of prefixes) {
            if (prefix && !raw.startsWith(prefix)) continue

            const text = prefix ? raw.slice(prefix.length).trimStart() : raw

            if (!text) continue

            const tree = this.trees.get(prefix)

            if (!tree) continue

            const found = this.matchPath(tree, text, messageType)

            if (!found) continue

            const rest = text.slice(restStart(text, found.end)).trim()

            return {
                registration: found.registration,
                match: {
                    command: text
                        .slice(0, found.end)
                        .replace(/\s+/g, ' ')
                        .trim(),
                    prefix,
                    args: [...rest.matchAll(/\S+/g)].map((token) => token[0]),
                    rest,
                },
            }
        }

        return null
    }

    private matchPath(
        root: CommandNode,
        text: string,
        messageType?: MessageType
    ): { registration: CommandRegistration; end: number } | null {
        let node = root
        let position = 0
        let best: { registration: CommandRegistration; end: number } | null =
            null

        while (position < text.length) {
            const start = position

            while (position < text.length && !isPathSeparator(text[position])) {
                position += 1
            }

            if (position === start) break

            const child = node.children.get(
                text.slice(start, position).toLowerCase()
            )

            if (!child) break

            node = child

            if (
                node.registration &&
                (messageType === undefined ||
                    node.registration.messageTypes.includes(messageType))
            ) {
                best = { registration: node.registration, end: position }
            }

            const next = skipPathSeparators(text, position)

            if (next === position) break

            position = next
        }

        return best
    }

    private withParams(registration: CommandRegistration): CommandRegistration {
        if (registration.params === undefined) return registration

        const compiled = compileCommandParams(registration.params)

        return {
            ...registration,
            paramsParser: compiled,
            usage: compiled.usage,
        }
    }

    private findNode(
        prefix: string,
        segments: string[]
    ): CommandNode | undefined {
        let node: CommandNode | undefined = this.trees.get(prefix)

        if (!node) return undefined

        for (const segment of segments) {
            const child: CommandNode | undefined = node.children.get(
                segment.toLowerCase()
            )

            if (!child) return undefined

            node = child
        }

        return node
    }

    private insert(
        registration: CommandRegistration,
        paths: string[]
    ): () => void {
        const prefixes = uniquePrefixes(registration.prefixes)
        const parsedPaths: ParsedPath[] = []
        const seen = new Set<string>()

        for (const value of paths) {
            const parsed = parsePath(value)
            const key = parsed.segments
                .map((segment) => segment.toLowerCase())
                .join('\0')

            if (seen.has(key)) continue

            seen.add(key)
            parsedPaths.push(parsed)
        }

        for (const prefix of prefixes) {
            for (const parsed of parsedPaths) {
                if (this.findNode(prefix, parsed.segments)?.registration) {
                    throw new Error(`command conflict: ${prefix}${parsed.path}`)
                }
            }
        }

        const placements: CommandPlacement[] = []

        for (const prefix of prefixes) {
            let root = this.trees.get(prefix)

            if (!root) {
                root = { children: new Map() }
                this.trees.set(prefix, root)
            }

            for (const parsed of parsedPaths) {
                const segments = parsed.segments.map((segment) =>
                    segment.toLowerCase()
                )
                let node = root

                for (const segment of segments) {
                    let child = node.children.get(segment)

                    if (!child) {
                        child = { children: new Map() }
                        node.children.set(segment, child)
                    }

                    node = child
                }

                node.registration = registration
                placements.push({ prefix, segments })
            }
        }

        this.registrations.add(registration)

        const pluginSet =
            this.byPlugin.get(registration.pluginId) ??
            new Set<CommandRegistration>()
        pluginSet.add(registration)
        this.byPlugin.set(registration.pluginId, pluginSet)

        let disposed = false

        const dispose = (): void => {
            if (disposed) return

            disposed = true

            for (const placement of placements) {
                this.removePlacement(registration, placement)
            }

            this.registrations.delete(registration)
            pluginSet.delete(registration)

            if (pluginSet.size === 0) {
                this.byPlugin.delete(registration.pluginId)
            }

            this.disposers.delete(registration)
        }

        this.disposers.set(registration, dispose)

        return dispose
    }

    private removePlacement(
        registration: CommandRegistration,
        placement: CommandPlacement
    ): void {
        const root = this.trees.get(placement.prefix)

        if (!root) return

        const stack: Array<{ node: CommandNode; segment: string }> = []
        let node = root

        for (const segment of placement.segments) {
            const child = node.children.get(segment)

            if (!child) return

            stack.push({ node: child, segment })
            node = child
        }

        if (node.registration === registration) {
            node.registration = undefined
        }

        for (let index = stack.length - 1; index >= 0; index -= 1) {
            const entry = stack[index]

            if (!entry) break
            if (entry.node.registration || entry.node.children.size > 0) break

            const parent = index === 0 ? root : stack[index - 1]?.node

            parent?.children.delete(entry.segment)
        }

        if (!root.registration && root.children.size === 0) {
            this.trees.delete(placement.prefix)
        }
    }

    private createGroupScope(
        pluginId: string,
        bases: string[],
        prefixes: string[],
        permission: Permission,
        messageTypes: MessageType[],
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
            register: <
                Declaration extends string = string,
                const TMessageType extends MessageTypeFilter | undefined =
                    MessageTypeFilter | undefined,
            >(
                options: CommandOptions<Declaration, TMessageType>,
                handler: CommandHandler<
                    CommandEventOf<TMessageType>,
                    CommandParamArgs<Declaration>
                >
            ) => {
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

                const registration = this.withParams({
                    pluginId,
                    name,
                    aliases: childBases.slice(1),
                    prefixes: options.prefixes ?? prefixes,
                    permission: options.permission ?? permission,
                    messageTypes:
                        options.messageType !== undefined
                            ? normalizeMessageTypes(options.messageType)
                            : [...messageTypes],
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                    ...(options.params !== undefined
                        ? { params: options.params }
                        : {}),
                    handler: handler as AnyCommandHandler,
                })
                const dispose = this.insert(registration, childBases)
                const record: GroupChild = {
                    name: options.name.trim(),
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                    ...(registration.usage !== undefined
                        ? { usage: registration.usage }
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

            group: <
                Declaration extends string = string,
                const TMessageType extends MessageTypeFilter | undefined =
                    MessageTypeFilter | undefined,
            >(
                options: CommandGroupOptions<Declaration, TMessageType>,
                nestedSetup: (
                    group: CommandGroupRegistrar<TMessageType>
                ) => void
            ) => {
                const nestedBases = composedBases(
                    bases,
                    options.name,
                    options.aliases ?? [],
                    'group'
                )
                const nestedPrefixes = options.prefixes ?? prefixes
                const nestedPermission = options.permission ?? permission
                const nestedMessageTypes =
                    options.messageType !== undefined
                        ? normalizeMessageTypes(options.messageType)
                        : [...messageTypes]
                const nestedChildren: GroupChild[] = []
                const nestedScope = this.createGroupScope(
                    pluginId,
                    nestedBases,
                    nestedPrefixes,
                    nestedPermission,
                    nestedMessageTypes,
                    nestedChildren
                )

                try {
                    nestedSetup(nestedScope.registrar)

                    const dispose = this.registerGroupRoot(
                        pluginId,
                        nestedBases,
                        nestedPrefixes,
                        nestedPermission,
                        nestedMessageTypes,
                        options.description,
                        options.params,
                        options.handler as AnyCommandHandler | undefined,
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
                    ...(options.params !== undefined
                        ? {
                              usage: compileCommandParams(options.params).usage,
                          }
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
        messageTypes: MessageType[],
        description: string | undefined,
        params: string | undefined,
        handler: AnyCommandHandler | undefined,
        children: GroupChild[]
    ): () => void {
        const name = bases[0]

        if (!name) {
            throw new Error('group name must not be empty')
        }

        const registration = this.withParams({
            pluginId,
            name,
            aliases: bases.slice(1),
            prefixes,
            permission,
            messageTypes: [...messageTypes],
            ...(description !== undefined ? { description } : {}),
            ...(params !== undefined ? { params } : {}),
            handler: handler ?? createGroupUsageHandler(children),
        })

        return this.insert(registration, bases)
    }
}
