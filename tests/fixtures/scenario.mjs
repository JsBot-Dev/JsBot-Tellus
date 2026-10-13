import assert from 'node:assert/strict'
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

const dispatch = event => bot.client.dispatchEvent(event)
const message = (user, raw, type = 'private') => ({
    post_type: 'message', message_type: type, user_id: user,
    raw_message: raw, message: [], message_id: 11, self_id: 99, time: 0,
    ...(type === 'group' ? { group_id: 42 } : {})
})
const notice = (target, subType = 'poke', groupId) => ({
    post_type: 'notice', notice_type: 'notify', sub_type: subType,
    self_id: 99, target_id: target, user_id: 3, time: 0,
    ...(groupId === undefined ? {} : { group_id: groupId })
})

switch (process.argv[2]) {
    case 'plugins': {
        await bot.start()
        assert.deepEqual(bot.plugins.internal.map(plugin => plugin.constructor.name), ['AuthPlugin'])
        assert.deepEqual(bot.plugins.integrated.map(plugin => plugin.constructor.name), ['EchoPlugin'])
        assert.deepEqual(bot.plugins.custom.map(plugin => plugin.constructor.name), ['PokePlugin'])
        assert.deepEqual([...bot.registrations.commands.keys()], ['role', 'utter', 'utter.raw'])
        assert.equal(bot.registrations.handlers.length, 1)
        assert.equal(bot.client.middlewares.length, 6)
        await bot.stop()
        break
    }
    case 'commands': {
        await bot.start()
        for (const [user, role] of [[1, 'SuperAdmin'], [2, 'Admin'], [3, 'User']]) {
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
    case 'retry': {
        let attempts = 0
        let finish
        bot.client.connect = () => {
            if (++attempts === 1) return Promise.reject(new Error('offline'))
            return new Promise(resolve => { finish = resolve })
        }
        const first = bot.start(), concurrent = bot.start()
        assert.equal(first, concurrent)
        await assert.rejects(first, /offline/)
        await assert.rejects(concurrent, /offline/)
        assert.equal(bot.client.middlewares.length, 6)
        const second = bot.start(), together = bot.start()
        assert.equal(second, together)
        assert.equal(attempts, 2)
        finish()
        await Promise.all([second, together])
        await bot.start()
        assert.equal(attempts, 2)
        assert.equal(bot.client.middlewares.length, 6)
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
        assert.equal(bot.client.middlewares.length, 6)
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
        bot.client.connect = () => new Promise((_, reject) => { rejectConnection = reject })
        bot.client.close = () => rejectConnection?.(new Error('connection closed'))
        const starting = bot.start()
        while (!rejectConnection) await new Promise(resolve => setImmediate(resolve))
        const stopping = bot.stop()
        await assert.rejects(starting, /connection closed/)
        await stopping
        assert.equal(bot.client.middlewares.length, 0)
        assert.equal(bot.plugiDb.db.open, false)
        break
    }
    default: throw new Error(`Unknown scenario: ${process.argv[2]}`)
}
