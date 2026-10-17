import { chain, fromCQString, isGroupMessageEvent, isMessageEvent, isPrivateMessageEvent, type CommandHandler, type EventHandler, type EventMiddleware, type OneBotMessageEvent } from "@snowluma/sdk";
import { Command, JsBot, JsBotBasePlugin, type PluginLevel } from "../../core";
import { Middleware, OnMessage } from "../../core/decorator/decorator";
import type { LLMContext } from "./types";
import { OpenAI } from "openai";

export default class LLMPlugin extends JsBotBasePlugin {
    static override level: PluginLevel = 'Internal'
    readonly context_size = 30
    llmclient: Record<string, OpenAI>
    constructor(bot: JsBot) {
        super(bot)
        let context = this.get_kv('Context') as LLMContext | undefined
        if (!context || typeof context !== 'object') context = {} as LLMContext
        if (!context.private) context.private = { sessions: {} }
        if (!context.private.sessions) context.private.sessions = {}
        if (!context.group) context.group = { sessions: {} }
        if (!context.group.sessions) context.group.sessions = {}
        this.set_kv('Context', context)
        let personas = this.get_kv('Personas') as Record<string, string> | undefined
        if (!personas || typeof personas !== 'object' || Array.isArray(personas)) {
            personas = {}
            const legacyPersona = this.get_kv('Persona')
            if (typeof legacyPersona === 'string' && legacyPersona) personas.default = legacyPersona
            this.set_kv('Personas', personas)
        }
        const currentPersona = this.get_kv('CurrentPersona')
        if (typeof currentPersona !== 'string' || !personas[currentPersona]) {
            if (personas.default) this.set_kv('CurrentPersona', 'default')
            else this.set_kv('CurrentPersona', '')
        }
        this.llmclient = {}
        for (const [name, config] of Object.entries(this.bot.config.llm.providers)) {
            this.llmclient[name] = new OpenAI({
                baseURL: config.base,
                apiKey: config.apikey
            })
        }
    }
    @Middleware()
    push_message: EventMiddleware = (event, ctx, next) => {
        if (!isMessageEvent(event)) return next()
        const context = this.get_kv('Context') as LLMContext
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
        this.set_kv('Context', context)
        return next()
    }

    @OnMessage()
    use_llm: EventHandler<OneBotMessageEvent> = async (event, ctx) => {
        let rawContext: OneBotMessageEvent[]
        if (isGroupMessageEvent(event)) {
            const mentions = event.raw_message.match(/\[CQ:at,qq=(\d+)\]/g) || []
            if (!mentions.some(mention => Number(mention.match(/qq=(\d+)/)?.[1]) === event.self_id)) return
            rawContext = (this.get_kv('Context') as LLMContext).group.sessions[event.group_id] || [event]
        } else if (isPrivateMessageEvent(event)) {
            rawContext = (this.get_kv('Context') as LLMContext).private.sessions[event.user_id] || [event]
        } else {
            return
        }
        const provider = this.get_kv('Provider')
        const model = this.get_kv('Model')
        if (!provider) return
        if (!this.llmclient[provider]) return
        if (!model) return
        const personas = this.get_kv('Personas') as Record<string, string> | undefined
        const currentPersona = this.get_kv('CurrentPersona')
        const persona = (currentPersona && personas?.[currentPersona]) || this.get_kv('Persona') || ''
        let input: OpenAI.Responses.ResponseInput = [{ role: 'developer', content: persona }]
        for (const msg of rawContext) input.push({
            role: msg.user_id === event.self_id ? 'assistant' : 'user',
            content: `${msg.sender.nickname}(${msg.user_id}):${msg.raw_message}`
        })
        let res: OpenAI.Responses.Response
        try {
            res = await this.llmclient[provider].responses.create({ model, input })
        } catch (error) {
            console.error(`[LLM] Request failed for provider "${provider}" and model "${model}":`, error)
            await this.bot.send_msg(ctx, `请求失败：${error}`)
            return
        }
        const text = res.output_text
        const messages = text.split(/(?<=[。！？；])/)
        let firstMessage = true
        for (const msg of messages) {
            if (msg.trim()) {
                if (!firstMessage) await new Promise((resolve) => { setTimeout(resolve, Math.random() * 5000) })
                await this.bot.send_msg(ctx, msg.trim()
                    .replace(/&amp;/g, '&')
                    .replace(/&#91;/g, '[')
                    .replace(/&#93;/g, ']')
                    .replace(/&#44;/g, ','))
                firstMessage = false
            }
        }
    }

    @Command('provider', { permission: 'SuperAdmin' })
    provider: CommandHandler = async (event, ctx, match) => {
        const providers = Object.keys(this.llmclient)
        if (!providers.length) {
            await this.bot.send_msg(ctx, '当前没有可用的提供商')
            return
        }

        const requested = match.rest.trim()
        if (!requested) {
            const selected = this.get_kv('Provider')
            const list = providers.map((provider, index) =>
                `${index + 1}. ${provider}${provider === selected ? '（当前）' : ''}`
            )
            await this.bot.send_msg(ctx, `可用提供商：\n${list.join('\n')}`)
            return
        }

        if (match.args.length !== 1) {
            await this.bot.send_msg(ctx, '提供商参数不合法，请输入提供商序号或名称')
            return
        }

        const index = /^\d+$/.test(requested) ? Number(requested) - 1 : -1
        const provider = index >= 0 ? providers[index] : requested
        if (!provider || !providers.includes(provider)) {
            await this.bot.send_msg(ctx, '提供商参数不合法，请输入有效的提供商序号或名称')
            return
        }

        if (provider !== this.get_kv('Provider')) {
            this.set_kv('Provider', provider)
            this.set_kv('Model', '')
        }
        await this.bot.send_msg(ctx, `已切换提供商：${provider}`)
    }

    @Command('model', { permission: 'SuperAdmin' })
    model: CommandHandler = async (event, ctx, match) => {
        const provider = this.get_kv('Provider')
        if (!provider) {
            await this.bot.send_msg(ctx, '请先设置提供商')
            return
        }
        const client = this.llmclient[provider]
        if (!client) {
            await this.bot.send_msg(ctx, `未找到提供商：${provider}`)
            return
        }

        let list: string[]
        try {
            list = (await client.models.list()).data
                .map(model => model.id)
                .filter((model): model is string => Boolean(model))
        } catch {
            await this.bot.send_msg(ctx, '获取模型列表失败，请检查提供商配置或网络连接')
            return
        }

        if (!list.length) {
            await this.bot.send_msg(ctx, '当前提供商没有可用模型')
            return
        }

        const requested = match.rest.trim()
        if (!requested) {
            const selected = this.get_kv('Model')
            const models = list.map((model, index) =>
                `${index + 1}. ${model}${model === selected ? '（当前）' : ''}`
            )
            await this.bot.send_msg(ctx, `可用模型：\n${models.join('\n')}`)
            return
        }

        if (match.args.length !== 1) {
            await this.bot.send_msg(ctx, '模型参数不合法，请输入模型序号或模型 ID')
            return
        }

        const index = /^\d+$/.test(requested) ? Number(requested) - 1 : -1
        const model = index >= 0 ? list[index] : requested
        if (!model || !list.includes(model)) {
            await this.bot.send_msg(ctx, '模型参数不合法，请输入模型序号或模型 ID')
            return
        }

        this.set_kv('Model', model)
        await this.bot.send_msg(ctx, `已切换模型：${model}`)
    }
    @Command('persona', { permission: 'SuperAdmin' })
    persona: CommandHandler = async (event, ctx, match) => {
        const personas = (this.get_kv('Personas') as Record<string, string> | undefined) || {}
        const current = this.get_kv('CurrentPersona') as string | undefined
        const requested = match.rest.trim()

        if (!requested) {
            const names = Object.keys(personas)
            if (!names.length) {
                await this.bot.send_msg(ctx, '当前没有 persona。使用 /persona add <名称> <提示词> 创建。')
                return
            }
            await this.bot.send_msg(ctx, `Persona 列表：\n${names.map(name => `${name}${name === current ? '（当前）' : ''}`).join('\n')}`)
            return
        }

        const [action, name, ...contentParts] = requested.split(/\s+/)
        if (action === 'add') {
            const content = requested.match(/^add\s+\S+\s+([\s\S]+)$/)?.[1]?.trim()
            if (!name || !content) {
                await this.bot.send_msg(ctx, '用法：/persona add <名称> <提示词>')
                return
            }
            personas[name] = content
            this.set_kv('Personas', personas)
            if (!current) this.set_kv('CurrentPersona', name)
            await this.bot.send_msg(ctx, `已保存 persona：${name}${!current ? '（当前）' : ''}`)
            return
        }

        if (action === 'use') {
            if (contentParts.length || !name || !personas[name]) {
                await this.bot.send_msg(ctx, '未找到 persona。用法：/persona use <名称>')
                return
            }
            this.set_kv('CurrentPersona', name)
            await this.bot.send_msg(ctx, `已切换 persona：${name}`)
            return
        }

        if (action === 'delete') {
            if (contentParts.length || !name || !personas[name]) {
                await this.bot.send_msg(ctx, '未找到 persona。用法：/persona delete <名称>')
                return
            }
            delete personas[name]
            this.set_kv('Personas', personas)
            if (current === name) {
                const fallback = Object.keys(personas)[0] || ''
                this.set_kv('CurrentPersona', fallback)
            }
            await this.bot.send_msg(ctx, `已删除 persona：${name}${current === name && Object.keys(personas).length ? `，当前切换为 ${this.get_kv('CurrentPersona')}` : ''}`)
            return
        }

        this.set_kv('Personas', personas)
        this.set_kv('CurrentPersona', 'default')
        this.set_kv('Persona', requested)
        await this.bot.send_msg(ctx, `已保存并切换到 persona：default\n${requested}`)
    }
}
