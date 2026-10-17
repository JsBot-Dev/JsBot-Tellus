import type { Registrations } from '../types/type'
import type {
    DecoratorContext,
    JsBotCommandOptions,
    MessageType,
} from './types'

function Command(name: string, options?: JsBotCommandOptions) {
    return function (value: any, context: DecoratorContext) {
        context.addInitializer(function (this: any) {
            const registrations = this.bot.registrations as Registrations
            const handler = context.access.get(this)
            if (typeof handler !== 'function')
                throw new TypeError(`${name} is not a function`)
            if (registrations.commands.get(name))
                throw new Error(`${name} has already been registered.`)
            registrations.commands.set(name, {
                name: name,
                handler: handler.bind(this),
                permission: options?.permission || 'User',
                docs: options?.docs || '',
                prefixes: options?.prefix || ['/'],
                plugin: this.constructor.name,
            })
        })
    }
}

function Middleware() {
    return function (value: any, context: DecoratorContext) {
        context.addInitializer(function (this: any) {
            const registrations = this.bot.registrations as Registrations
            const handler = context.access.get(this)
            if (typeof handler !== 'function')
                throw new TypeError(`A Middleware Handler is not a function`)
            registrations.middlewares.push({
                handler: handler.bind(this),
                plugin: this.constructor.name,
            })
        })
    }
}

function OnMessage(type?: MessageType) {
    return function (value: any, context: DecoratorContext) {
        context.addInitializer(function (this: any) {
            const registrations = this.bot.registrations as Registrations
            const handler = context.access.get(this)
            if (typeof handler !== 'function')
                throw new TypeError(`A Message Handler is not a function`)
            registrations.handlers.push({
                type: 'message',
                handler: handler.bind(this),
                message_type: type,
                plugin: this.constructor.name,
            })
        })
    }
}

function OnNotice(type?: string) {
    return function (value: any, context: DecoratorContext) {
        context.addInitializer(function (this: any) {
            const registrations = this.bot.registrations as Registrations
            const handler = context.access.get(this)
            if (typeof handler !== 'function')
                throw new TypeError(`A Notice Handler is not a function`)
            registrations.handlers.push({
                type: 'notice',
                handler: handler.bind(this),
                notice_type: type,
                plugin: this.constructor.name,
            })
        })
    }
}

function OnRequest(type?: string) {
    return function (value: any, context: DecoratorContext) {
        context.addInitializer(function (this: any) {
            const registrations = this.bot.registrations as Registrations
            const handler = context.access.get(this)
            if (typeof handler !== 'function')
                throw new TypeError(`A Request Handler is not a function`)
            registrations.handlers.push({
                type: 'request',
                handler: handler.bind(this),
                request_type: type,
                plugin: this.constructor.name,
            })
        })
    }
}

export { Command, Middleware, OnMessage, OnRequest, OnNotice }
