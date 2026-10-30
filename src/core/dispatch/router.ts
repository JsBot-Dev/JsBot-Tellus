import type {
    EventNext,
    OneBotMessageEvent,
    SnowLumaEvent,
    SnowLumaEventContextWithQuote,
} from '@snowluma/sdk'
import { isMessageEvent, isNoticeEvent, isRequestEvent } from '@snowluma/sdk'
import type { Logger } from '../logging/logger.js'
import type { MessageSender } from '../messaging/sender.js'
import { CommandParamsError } from '../plugin/command-params.js'
import type { PluginGate } from '../plugin/gating.js'
import type {
    CommandGroupRegistrar,
    CommandHandler,
    CommandInfo,
    EventType,
    MessageHandler,
    MiddlewareOptions,
    NoticeHandler,
    NoticeOptions,
    PluginMiddleware,
    RequestHandler,
    RequestOptions,
} from '../plugin/types.js'
import type { RoleService } from '../security/roles.js'
import { PermissionRefuser } from '../security/refuse.js'
import type { Permission } from '../security/permission.js'
import {
    CommandRegistry,
    type CommandGroupRegistration,
    type CommandRegistration,
} from './command.js'
import {
    createEventContext,
    eventTypeOf,
    HandlerRegistry,
    isNoticeOf,
    isRequestOf,
} from './handler.js'
import {
    MiddlewareRegistry,
    type MiddlewareRegistration,
} from './middleware.js'

export type RouterEventMiddleware = (
    event: SnowLumaEvent,
    context: SnowLumaEventContextWithQuote,
    next: EventNext
) => void | Promise<void>

export interface RouterDeps {
    sender: MessageSender
    roles: RoleService
    gate: PluginGate
    logger: Logger
    onEvent?: ((event: SnowLumaEvent) => void) | undefined
}

type AnyCommandHandler = CommandHandler<OneBotMessageEvent, any[]>

export interface RegisterCommandOptions {
    pluginId: string
    name: string
    aliases?: string[] | undefined
    prefixes?: string[] | undefined
    permission?: Permission | undefined
    description?: string | undefined
    params?: string | undefined
    handler: AnyCommandHandler
}

export interface RegisterCommandGroupOptions {
    pluginId: string
    name: string
    aliases?: string[] | undefined
    prefixes?: string[] | undefined
    permission?: Permission | undefined
    description?: string | undefined
    params?: string | undefined
    handler?: AnyCommandHandler | undefined
}

export interface RegisterNoticeOptions extends NoticeOptions {
    pluginId: string
    handler: NoticeHandler
}

export interface RegisterRequestOptions extends RequestOptions {
    pluginId: string
    handler: RequestHandler
}

export interface RegisterMiddlewareOptions extends MiddlewareOptions {
    pluginId: string
    handler: PluginMiddleware
}

export class Router {
    accepting = false

    private readonly logger: Logger
    private readonly sender: MessageSender
    private readonly roles: RoleService
    private readonly gate: PluginGate
    private readonly refuser: PermissionRefuser
    private readonly commands = new CommandRegistry()
    private readonly handlers = new HandlerRegistry()
    private readonly middlewares = new MiddlewareRegistry()
    private readonly active = new Set<Promise<void>>()
    private readonly onEvent: ((event: SnowLumaEvent) => void) | undefined

    constructor(deps: RouterDeps) {
        this.sender = deps.sender
        this.roles = deps.roles
        this.gate = deps.gate
        this.logger = deps.logger.child('router')
        this.onEvent = deps.onEvent
        this.refuser = new PermissionRefuser(deps.sender, this.logger)
    }

    readonly dispatch: RouterEventMiddleware = async (
        event,
        sdkContext,
        next
    ) => {
        if (!this.accepting) return

        this.emitEvent(event)

        const run = this.handleEvent(event, sdkContext, next)
        this.active.add(run)

        try {
            await run
        } finally {
            this.active.delete(run)
        }
    }

    private emitEvent(event: SnowLumaEvent): void {
        if (!this.onEvent) return

        try {
            this.onEvent(event)
        } catch (error) {
            this.logger.error('event tap failed', error)
        }
    }

    private async handleEvent(
        event: SnowLumaEvent,
        sdkContext: SnowLumaEventContextWithQuote,
        next: EventNext
    ): Promise<void> {
        try {
            const context = createEventContext(event, sdkContext, this.sender)

            await this.runMiddlewares(event, context)

            if (context.stopped) return

            if (isMessageEvent(event)) {
                const found = this.commands.match(event.raw_message)

                if (found) {
                    sdkContext.stopPropagation()

                    if (
                        !this.gate.isEnabled(found.registration.pluginId, event)
                    ) {
                        return
                    }

                    const role = this.roles.roleOf(event.user_id)

                    if (!this.roles.can(role, found.registration.permission)) {
                        await this.refuser.send(
                            event,
                            sdkContext,
                            found.registration.permission,
                            role
                        )
                        return
                    }

                    const commandContext = createEventContext(
                        event,
                        sdkContext,
                        this.sender,
                        found.match
                    )
                    let args: unknown[] = []

                    if (found.registration.paramsParser) {
                        try {
                            const parsed =
                                found.registration.paramsParser.parse(
                                    found.match.rest,
                                    event
                                )

                            args = parsed.args

                            if (parsed.ignored.length > 0) {
                                this.logger.debug(
                                    `ignored extra arguments for ${found.registration.name}`,
                                    parsed.ignored.join(' ')
                                )
                            }
                        } catch (error) {
                            if (error instanceof CommandParamsError) {
                                await commandContext.send(
                                    `${error.message}\n用法：${found.match.prefix}${found.registration.name} ${error.usage}`,
                                    { quote: false }
                                )
                                return
                            }

                            throw error
                        }
                    }

                    await this.safeRun(
                        found.registration.pluginId,
                        'command',
                        () =>
                            found.registration.handler(
                                event,
                                commandContext,
                                found.match,
                                ...args
                            )
                    )

                    return
                }
            }

            await this.runHandlers(event, sdkContext)
        } catch (error) {
            this.logger.error('dispatch failed', error)
        } finally {
            if (!sdkContext.stopped) {
                try {
                    await next()
                } catch (error) {
                    this.logger.error('sdk next failed', error)
                }
            }
        }
    }

    registerCommand(options: RegisterCommandOptions): () => void {
        const registration: CommandRegistration = {
            pluginId: options.pluginId,
            name: options.name,
            aliases: options.aliases ?? [],
            prefixes: options.prefixes ?? ['/'],
            permission: options.permission ?? 'User',
            ...(options.description !== undefined
                ? { description: options.description }
                : {}),
            ...(options.params !== undefined ? { params: options.params } : {}),
            handler: options.handler,
        }

        return this.commands.register(registration)
    }

    registerCommandGroup(
        options: RegisterCommandGroupOptions,
        setup: (group: CommandGroupRegistrar) => void
    ): () => void {
        const registration: CommandGroupRegistration = {
            pluginId: options.pluginId,
            name: options.name,
            aliases: options.aliases ?? [],
            prefixes: options.prefixes ?? ['/'],
            permission: options.permission ?? 'User',
            ...(options.description !== undefined
                ? { description: options.description }
                : {}),
            ...(options.params !== undefined ? { params: options.params } : {}),
            ...(options.handler !== undefined
                ? { handler: options.handler }
                : {}),
        }

        return this.commands.group(registration, setup)
    }

    registerMessage(pluginId: string, handler: MessageHandler): () => void {
        return this.handlers.registerMessage(pluginId, handler)
    }

    registerNotice(options: RegisterNoticeOptions): () => void {
        return this.handlers.registerNotice({
            pluginId: options.pluginId,
            ...(options.noticeType !== undefined
                ? { noticeType: options.noticeType }
                : {}),
            ...(options.subType !== undefined
                ? { subType: options.subType }
                : {}),
            handler: options.handler,
        })
    }

    registerRequest(options: RegisterRequestOptions): () => void {
        return this.handlers.registerRequest({
            pluginId: options.pluginId,
            ...(options.requestType !== undefined
                ? { requestType: options.requestType }
                : {}),
            handler: options.handler,
        })
    }

    registerMiddleware(options: RegisterMiddlewareOptions): () => void {
        const registration: MiddlewareRegistration = {
            pluginId: options.pluginId,
            ...(options.name !== undefined ? { name: options.name } : {}),
            eventTypes: options.eventTypes ?? ['message'],
            priority: options.priority ?? 0,
            handler: options.handler,
        }

        return this.middlewares.register(registration)
    }

    removePlugin(pluginId: string): void {
        this.commands.removePlugin(pluginId)
        this.handlers.removePlugin(pluginId)
        this.middlewares.removePlugin(pluginId)
    }

    listCommands(): ReadonlyArray<CommandInfo> {
        return this.commands.list()
    }

    async drain(timeoutMs = 5_000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs

        for (;;) {
            const pending = [...this.active]

            if (pending.length === 0) return true

            const remaining = deadline - Date.now()

            if (remaining <= 0) return false

            const completed = await new Promise<boolean>((resolve) => {
                let settled = false

                const timer = setTimeout(() => {
                    if (settled) return

                    settled = true
                    resolve(false)
                }, remaining)

                void Promise.allSettled(pending).then(() => {
                    if (settled) return

                    settled = true
                    clearTimeout(timer)
                    resolve(true)
                })
            })

            if (!completed) return false
        }
    }

    private async runMiddlewares(
        event: SnowLumaEvent,
        context: ReturnType<typeof createEventContext>
    ): Promise<void> {
        const eventType = eventTypeOf(event)

        if (!eventType) return

        const list = this.middlewares
            .list(eventType)
            .filter((item) => this.gate.isEnabled(item.pluginId, event))

        let index = -1

        const next = async (): Promise<void> => {
            index += 1

            const middleware = list[index]

            if (!middleware || context.stopped) return

            let called = false

            const nextOnce = async (): Promise<void> => {
                if (called) return

                called = true
                await next()
            }

            try {
                await middleware.handler(event, context, nextOnce)
            } catch (error) {
                this.logger.error(
                    `plugin ${middleware.pluginId} middleware failed`,
                    error
                )
                await nextOnce()
            }
        }

        await next()
    }

    private async runHandlers(
        event: SnowLumaEvent,
        sdkContext: SnowLumaEventContextWithQuote
    ): Promise<void> {
        if (isMessageEvent(event)) {
            const messageContext = createEventContext(
                event,
                sdkContext,
                this.sender
            )

            for (const registration of this.handlers.messages()) {
                if (messageContext.stopped) return

                if (!this.gate.isEnabled(registration.pluginId, event)) {
                    continue
                }

                await this.safeRun(
                    registration.pluginId,
                    'message handler',
                    () => registration.handler(event, messageContext)
                )
            }

            return
        }

        if (isNoticeEvent(event)) {
            const noticeContext = createEventContext(
                event,
                sdkContext,
                this.sender
            )

            for (const registration of this.handlers.notices()) {
                if (noticeContext.stopped) return

                if (!isNoticeOf(event, registration)) continue

                if (!this.gate.isEnabled(registration.pluginId, event)) {
                    continue
                }

                await this.safeRun(
                    registration.pluginId,
                    'notice handler',
                    () => registration.handler(event, noticeContext)
                )
            }

            return
        }

        if (isRequestEvent(event)) {
            const requestContext = createEventContext(
                event,
                sdkContext,
                this.sender
            )

            for (const registration of this.handlers.requests()) {
                if (requestContext.stopped) return

                if (!isRequestOf(event, registration)) continue

                if (!this.gate.isEnabled(registration.pluginId, event)) {
                    continue
                }

                await this.safeRun(
                    registration.pluginId,
                    'request handler',
                    () => registration.handler(event, requestContext)
                )
            }
        }
    }

    private async safeRun(
        pluginId: string,
        kind: string,
        run: () => void | Promise<void>
    ): Promise<void> {
        try {
            await run()
        } catch (error) {
            this.logger.error(`plugin ${pluginId} ${kind} failed`, error)
        }
    }
}
