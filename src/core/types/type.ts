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
}
interface HandlerMeta {
    type: EventType,
    handler: EventHandler<SnowLumaEvent>
    message_type?: MessageType
    notice_type?: string | undefined
    request_type?: string | undefined
}
interface Plugins {
    custom: Array<JsBotBasePlugin>
    integrated: Array<JsBotBasePlugin>
    internal: Array<JsBotBasePlugin>
}
interface Registrations {
    commands: Map<string, CommandMeta>
    middlewares: Array<EventMiddleware>
    handlers: Array<HandlerMeta>
}
interface JsBotOptions {
    pluginUrl?: string
}
type CommandContext = SnowLumaEventContext<SnowLumaEvent> & {
    command?: CommandMatch;
}
export type { PluginLevel, CommandMeta, HandlerMeta, Plugins, Registrations, JsBotOptions, CommandContext }