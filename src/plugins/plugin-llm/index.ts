import { isGroupMessageEvent, isMessageEvent, isPrivateMessageEvent, type CommandHandler, type EventHandler, type EventMiddleware, type OneBotMessageEvent } from "@snowluma/sdk";
import { Command, JsBot, JsBotBasePlugin, type PluginLevel } from "../../core";
import { Middleware, OnMessage } from "../../core/decorator/decorator";
import type { LLMContext } from "./types";
import { OpenAI } from "openai";

export default class LLMPlugin extends JsBotBasePlugin {
    static override level: PluginLevel = 'Internal'
    readonly context_key = 'LLM-context'
    readonly context_size = 30
    llmclient: OpenAI
    constructor(bot: JsBot) {
        super(bot)
        let context = this.get_kv(this.context_key) as LLMContext | undefined
        if (!context || typeof context !== 'object') context = {} as LLMContext
        if (!context.private) context.private = { sessions: {} }
        if (!context.private.sessions) context.private.sessions = {}
        if (!context.group) context.group = { sessions: {} }
        if (!context.group.sessions) context.group.sessions = {}
        this.set_kv(this.context_key, context)
        this.llmclient = new OpenAI({
            baseURL: this.bot.config.llm.base,
            apiKey: this.bot.config.llm.apikey
        })
    }
    @Middleware()
    push_message: EventMiddleware = (event, ctx, next) => {
        if (!isMessageEvent(event)) return next()
        const context = this.get_kv(this.context_key) as LLMContext
        if (isGroupMessageEvent(event)) {
            const group = event.group_id
            let groupContext = context.group.sessions[group] || []
            groupContext.push(event)
            groupContext = groupContext.slice(-this.context_size)
            context.group.sessions[group] = groupContext
        }
        if (isPrivateMessageEvent(event)) {
            const user = event.user_id
            let privateContext = context.private.sessions[user] || []
            privateContext.push(event)
            privateContext = privateContext.slice(-this.context_size)
            context.private.sessions[user] = privateContext
        }
        this.set_kv(this.context_key, context)
        return next()
    }

    @OnMessage()
    use_llm: EventHandler<OneBotMessageEvent> = async (event, ctx) => {
        const m = event.raw_message.match(/\[CQ:at,qq=(\d+)\]/)
        if (Number(m?.[1]) !== event.self_id) return
        if (!isGroupMessageEvent(event)) return
        const rawContext = (this.get_kv(this.context_key) as LLMContext).group.sessions[event.group_id] || [event]
        const model = this.get_kv('LLM-Model')
        if (!model) return
        let input: OpenAI.Responses.ResponseInput = [{ role: 'developer', content: this.get_kv('LLM-Persona') }]
        for (const msg of rawContext) input.push({
            role: (msg.user_id === event.self_id) ? 'assistant' : 'user',
            content: `${msg.sender.nickname}(${msg.user_id}):${msg.raw_message}`
        })
        const res = await this.llmclient.responses.create({ model, input })
        const text = res.output_text
        const messages = text.split(/(?<=[。！？；])/)
        for (const msg of messages) if (msg.trim()) await ctx.reply(msg.trim())
    }
}
