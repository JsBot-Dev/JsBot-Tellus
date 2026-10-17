import type { CommandHandler, CommandMatch, EventHandler, EventMiddleware, OneBotMessageEvent, OneBotNoticeEvent, SnowLumaEvent, SnowLumaEventContext } from "@snowluma/sdk";
import type { JsBotBasePlugin } from "../plugin/base";
import type { MessageType, PermissionType } from "../decorator/types";

type PluginLevel = 'Internal' | 'Integrated' | 'Custom'
type EventType = 'notice' | 'message' | 'request'
interface CommandMeta {
    name: string
    handler: CommandHandler
    permission: PermissionType
    docs?: string
    prefixes: string[]
    plugin: string
}
interface HandlerMeta {
    type: EventType,
    handler: EventHandler<SnowLumaEvent>
    message_type?: MessageType
    notice_type?: string | undefined
    request_type?: string | undefined
    plugin: string
}
interface MiddlewareMeta {
    handler: EventMiddleware
    plugin: string
}
interface Plugins {
    custom: Array<JsBotBasePlugin>
    integrated: Array<JsBotBasePlugin>
    internal: Array<JsBotBasePlugin>
}
interface Registrations {
    commands: Map<string, CommandMeta>
    middlewares: Array<MiddlewareMeta>
    handlers: Array<HandlerMeta>
}
interface JsBotOptions {
    pluginUrl?: string
}
type CommandContext = SnowLumaEventContext<SnowLumaEvent> & {
    command?: CommandMatch;
}
export type { PluginLevel, CommandMeta, HandlerMeta, MiddlewareMeta, Plugins, Registrations, JsBotOptions, CommandContext }