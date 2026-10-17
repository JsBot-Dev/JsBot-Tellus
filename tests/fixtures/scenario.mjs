import assert from 'node:assert/strict'
import { chain, toCQString } from '@snowluma/sdk'
import { JsBot } from './src/core/bot.ts'

const bot = new JsBot()
const sent = []
bot.client.sendPrivateMessage = async (id, content) => {
    sent.push({ kind: 'private', id, content })
    return { message_id: 1 }
}
bot.client.sendGroupMessage = async (id, content) => {
    sent.push({ kind: 'group', id, content })
    return { message_id: 1 }
}
bot.client.connect = async () => {}

const dispatch = (event) => bot.client.dispatchEvent(event)
const message = (user, raw, type = 'private') => ({
    post_type: 'message',
    message_type: type,
    user_id: user,
    raw_message: raw,
    message: [],
    message_id: 11,
    self_id: 99,
    time: 0,
    ...(type === 'group' ? { group_id: 42 } : {}),
})
const notice = (target, subType = 'poke', groupId) => ({
    post_type: 'notice',
    notice_type: 'notify',
    sub_type: subType,
    self_id: 99,
    target_id: target,
    user_id: 3,
    time: 0,
    ...(groupId === undefined ? {} : { group_id: groupId }),
})

switch (process.argv[2]) {
    case 'plugins':
    case 'plugins-extra': {
        await bot.start()
        for (const [level, name] of [
            ['internal', 'AuthPlugin'],
            ['integrated', 'EchoPlugin'],
            ['custom', 'PokePlugin'],
        ]) {
            assert.ok(
                bot.plugins[level].some(
                    (plugin) => plugin.constructor.name === name
                ),
                `${name} not loaded as ${level}`
            )
        }
        for (const name of ['role', 'utter', 'utter.raw']) {
            assert.ok(
                bot.registrations.commands.has(name),
                `${name} not registered`
            )
        }
        assert.ok(
            bot.registrations.handlers.some(
                (handler) =>
                    handler.type === 'notice' &&
                    handler.notice_type === 'notify'
            )
        )
        assert.ok(bot.client.middlewares.length > 0)
        if (process.argv[2] === 'plugins-extra') {
            assert.ok(
                bot.plugins.custom.some(
                    (plugin) => plugin.constructor.name === 'ExtraPlugin'
                )
            )
            assert.ok(bot.registrations.commands.has('extra.test'))
            assert.ok(
                bot.registrations.handlers.some(
                    (handler) =>
                        handler.type === 'notice' &&
                        handler.notice_type === 'extra-test'
                )
            )
            assert.ok(bot.registrations.middlewares.length > 0)
        }
        await bot.stop()
        break
    }
    case 'commands': {
        await bot.start()
        for (const [user, role] of [
            [1, 'SuperAdmin'],
            [2, 'Admin'],
            [3, 'User'],
        ]) {
            sent.length = 0
            await dispatch(message(user, '/role'))
            assert.equal(sent.length, 1)
            assert.equal(sent[0].content, role)
        }
        sent.length = 0
        await dispatch(message(3, '/utter hello'))
        assert.equal(sent.length, 1)
        assert.match(JSON.stringify(sent[0].content), /权限不足/)
        sent.length = 0
        await dispatch(message(2, '/utter hello'))
        assert.equal(sent.length, 1)
        assert.equal(sent[0].content, 'hello')
        sent.length = 0
        await dispatch(message(1, '/utter.raw hello'))
        assert.equal(sent.length, 1)
        assert.match(JSON.stringify(sent[0].content), /hello/)
        sent.length = 0
        await dispatch(message(3, '/utter hello', 'group'))
        assert.equal(sent.length, 1)
        assert.equal(sent[0].kind, 'group')
        assert.match(JSON.stringify(sent[0].content), /权限不足/)
        await bot.stop()
        break
    }
    case 'poke': {
        await bot.start()
        await dispatch(notice(98, 'poke', 42))
        await dispatch(notice(99, 'other', 42))
        assert.equal(sent.length, 0)
        await dispatch(notice(99, 'poke', 42))
        assert.equal(sent.length, 1)
        assert.equal(sent[0].kind, 'group')
        assert.equal(sent[0].id, 42)
        await dispatch(notice(99))
        assert.equal(sent.length, 2)
        assert.equal(sent[1].kind, 'private')
        assert.equal(sent[1].id, 3)
        await bot.stop()
        break
    }
    case 'group-plugin-gating': {
        await bot.start()
        bot.config.plugin.PokePlugin = { status: 'Disable', list: [42] }
        bot.config.plugin.ExtraPlugin = { status: 'Disable', list: [42] }
        await dispatch(notice(99, 'poke', 42))
        assert.equal(sent.length, 0)
        await dispatch(notice(99, 'poke'))
        assert.equal(sent.length, 1)
        assert.equal(sent[0].kind, 'private')
        await dispatch({
            post_type: 'notice',
            notice_type: 'group-test',
            group_id: 42,
            self_id: 99,
            time: 0,
        })
        await dispatch({
            post_type: 'notice',
            notice_type: 'group-test',
            group_id: 43,
            self_id: 99,
            time: 0,
        })
        await dispatch({
            post_type: 'request',
            request_type: 'group',
            group_id: 42,
            self_id: 99,
            user_id: 3,
            flag: 'x',
            time: 0,
        })
        assert.equal(sent.length, 2)
        await dispatch({
            post_type: 'request',
            request_type: 'group',
            group_id: 43,
            self_id: 99,
            user_id: 3,
            flag: 'y',
            time: 0,
        })
        assert.equal(sent.length, 3)
        await bot.stop()
        break
    }
    case 'command-order': {
        await bot.start()
        await dispatch(message(3, '/extra.test'))
        assert.deepEqual(
            sent.map((entry) => entry.content),
            ['middleware']
        )
        sent.length = 0
        await dispatch(message(3, 'ordinary text'))
        assert.deepEqual(
            sent.map((entry) => entry.content),
            ['middleware', 'message']
        )
        await bot.stop()
        break
    }
    case 'send-message-forwarding': {
        bot.config.message = { charThreshold: 100, lineThreshold: 3 }
        const calls = []
        bot.client.getLoginInfo = async () => ({ nickname: 'Bot' })
        bot.client.sendGroupForwardMessage = async (groupId, content) =>
            calls.push({ kind: 'forward', groupId, content })
        const ctx = {
            event: message(3, '/test', 'group'),
            client: bot.client,
            reply: async (content) => calls.push({ kind: 'reply', content }),
        }
        const shortReply = chain().reply(11).text('ok')
        await bot.send_msg(ctx, shortReply)
        assert.equal(calls[0].kind, 'reply')
        assert.equal(calls[0].content, shortReply)

        bot.config.message.charThreshold = 10_000
        const exactLines = chain().text('a\nb\nc')
        await bot.send_msg(ctx, exactLines)
        assert.equal(calls[1].kind, 'reply')
        const extraLine = chain().text('a\nb\nc\nd')
        await bot.send_msg(ctx, extraLine)
        assert.equal(calls[2].kind, 'forward')

        bot.config.message.lineThreshold = 100
        const exactCharacters = chain().text('1234567890')
        bot.config.message.charThreshold = toCQString(exactCharacters).length
        await bot.send_msg(ctx, exactCharacters)
        assert.equal(calls[3].kind, 'reply')
        const extraCharacter = chain().text('12345678901')
        bot.config.message.charThreshold = toCQString(extraCharacter).length - 1
        await bot.send_msg(ctx, extraCharacter)
        assert.equal(calls[4].kind, 'forward')

        bot.config.message.charThreshold = 100
        const longReply = chain().reply(11).text('long response '.repeat(20))
        await bot.send_msg(ctx, longReply)
        assert.equal(calls[5].kind, 'forward')
        assert.equal(calls[5].groupId, 42)
        const forwardNodes = calls[5].content.toArray()
        assert.equal(forwardNodes[0].type, 'node')
        assert.ok(
            forwardNodes[0].data.content
                .toArray()
                .some(
                    (segment) =>
                        segment.type === 'reply' && segment.data.id === '11'
                )
        )
        await bot.stop()
        break
    }
    case 'retry':
    case 'retry-extra': {
        let attempts = 0
        let finish
        bot.client.connect = () => {
            if (++attempts === 1) return Promise.reject(new Error('offline'))
            return new Promise((resolve) => {
                finish = resolve
            })
        }
        const first = bot.start(),
            concurrent = bot.start()
        assert.equal(first, concurrent)
        await assert.rejects(first, /offline/)
        await assert.rejects(concurrent, /offline/)
        const registeredMiddlewares = bot.client.middlewares.length
        assert.ok(registeredMiddlewares > 0)
        const second = bot.start(),
            together = bot.start()
        assert.equal(second, together)
        assert.equal(attempts, 2)
        finish()
        await Promise.all([second, together])
        await bot.start()
        assert.equal(attempts, 2)
        assert.equal(bot.client.middlewares.length, registeredMiddlewares)
        await bot.stop()
        break
    }
    case 'rollback': {
        const command = bot.client.command.bind(bot.client)
        let calls = 0
        bot.client.command = (...args) => {
            if (++calls === 2) throw new Error('registration failed')
            return command(...args)
        }
        await assert.rejects(bot.start(), /registration failed/)
        assert.equal(bot.client.middlewares.length, 0)
        bot.client.command = command
        await bot.start()
        assert.ok(bot.client.middlewares.length > 0)
        await bot.stop()
        break
    }
    case 'constructor-kv': {
        await bot.start()
        const plugin = bot.plugins.custom.find(
            (plugin) => plugin.constructor.name === 'ConstructorKvPlugin'
        )
        assert.equal(plugin.initial, 0)
        assert.equal(plugin.get_kv('counter'), 1)
        await bot.stop()
        break
    }
    case 'constructor-retry': {
        const instantiate = bot.pluginManager.load.instantiate.bind(
            bot.pluginManager.load
        )
        let failedDatabase
        bot.pluginManager.load.instantiate = (...args) => {
            failedDatabase = bot.plugiDb.db
            return instantiate(...args)
        }
        await assert.rejects(bot.start(), /constructor failed/)
        assert.equal(failedDatabase.open, false)
        assert.equal(bot.plugiDb, undefined)
        assert.equal(bot.client.middlewares.length, 0)
        await bot.start()
        const plugin = bot.plugins.custom.find(
            (plugin) => plugin.constructor.name === 'ConstructorKvPlugin'
        )
        assert.equal(plugin.initial, 1)
        assert.equal(plugin.get_kv('counter'), 2)
        await bot.stop()
        break
    }
    case 'stop': {
        await bot.start()
        const database = bot.plugiDb.db
        const first = bot.stop()
        assert.equal(first, bot.stop())
        await first
        assert.equal(database.open, false)
        assert.equal(bot.client.middlewares.length, 0)
        assert.equal(bot.started, false)
        await assert.rejects(bot.start(), /shutting down/)
        break
    }
    case 'stop-during-connect': {
        let rejectConnection
        bot.client.connect = () =>
            new Promise((_, reject) => {
                rejectConnection = reject
            })
        bot.client.close = () =>
            rejectConnection?.(new Error('connection closed'))
        const starting = bot.start()
        while (!rejectConnection)
            await new Promise((resolve) => setImmediate(resolve))
        const stopping = bot.stop()
        await assert.rejects(starting, /connection closed/)
        await stopping
        assert.equal(bot.client.middlewares.length, 0)
        assert.equal(bot.plugiDb.db.open, false)
        break
    }
    default:
        throw new Error(`Unknown scenario: ${process.argv[2]}`)
}
