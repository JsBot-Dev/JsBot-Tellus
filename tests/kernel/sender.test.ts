import {
    createEventContext,
    type OutgoingMessage,
    type SnowLumaApiClient,
    type SnowLumaEvent,
} from '@snowluma/sdk'
import { describe, expect, it } from 'vitest'
import {
    createMessageSender,
    type MessageSender,
} from '../../src/core/messaging/sender.js'
import { FakeClient } from '../helpers/fake-client.js'
import { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage, privateMessage } from '../helpers/events.js'
import { createCapturingLogger, createTestLogger } from '../helpers/loggers.js'

interface CreatedSender {
    sender: MessageSender
    client: FakeClient
}

const shortMessageConfig = {
    charThreshold: 10,
    lineThreshold: 2,
}

function createSender(thresholds = shortMessageConfig): CreatedSender {
    const client = new FakeClient()

    const sender = createMessageSender({
        client,
        message: thresholds,
        logger: createTestLogger(),
    })

    return { sender, client }
}

describe('message sender', () => {
    it('quotes a short group message by default', async () => {
        const { sender, client } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi')

        expect(context.quotes).toEqual([{ message: 'hi', options: undefined }])
        expect(context.replies).toHaveLength(1)
        expect(client.sent).toHaveLength(0)
    })

    it('adds a CQ reply segment when quoting', async () => {
        const { sender } = createSender()
        const event = groupMessage({ message_id: 42 })
        const sent: OutgoingMessage[] = []
        const sdkContext = createEventContext(event, {
            sendGroupMessage: async (
                _groupId: number,
                message: OutgoingMessage
            ) => {
                sent.push(message)
                return { message_id: 1 }
            },
        } as unknown as SnowLumaApiClient)

        await sender.send(event, sdkContext, 'hi')

        expect(sent).toEqual(['[CQ:reply,id=42]hi'])
    })

    it('sends directly when quote is false', async () => {
        const { sender, client } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi', {
            quote: false,
        })

        expect(context.quotes).toHaveLength(0)
        expect(client.sent).toEqual([
            {
                kind: 'group',
                id: event.group_id,
                message: 'hi',
                options: undefined,
            },
        ])
    })

    it('quotes in private chats', async () => {
        const { sender } = createSender()
        const event = privateMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi')

        expect(context.quotes).toHaveLength(1)
    })

    it('forwards long group messages', async () => {
        const { sender, client } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, '12345678901')

        expect(context.replies).toHaveLength(0)
        expect(client.sent).toHaveLength(1)

        const sent = client.sent[0]

        expect(sent?.kind).toBe('group-forward')
        expect(sent?.id).toBe(event.group_id)

        const chain = sent?.message as {
            toJSON(): Array<{
                type: string
                data: {
                    user_id: number
                    nickname: string
                    content: unknown
                }
            }>
        }
        const segment = chain.toJSON()[0]

        expect(segment?.type).toBe('node')
        expect(segment?.data.user_id).toBe(event.self_id)
        expect(segment?.data.nickname).toBe('FakeBot')
        expect(segment?.data.content).toBe('12345678901')
    })

    it('forwards long private messages', async () => {
        const { sender, client } = createSender()
        const event = privateMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, '12345678901')

        expect(client.sent[0]?.kind).toBe('private-forward')
        expect(client.sent[0]?.id).toBe(event.user_id)
    })

    it('forwards messages with too many lines', async () => {
        const { sender, client } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'a\nb\nc')

        expect(client.sent[0]?.kind).toBe('group-forward')
    })

    it('passes autoEscape through', async () => {
        const { sender, client } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi', {
            quote: false,
            autoEscape: true,
        })

        expect(client.sent[0]?.options).toEqual({
            autoEscape: true,
        })
    })

    it('passes autoEscape through when quoting', async () => {
        const { sender } = createSender()
        const event = groupMessage()
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi', {
            autoEscape: true,
        })

        expect(context.quotes[0]?.options).toEqual({
            autoEscape: true,
        })
    })

    it('sends to group sessions', async () => {
        const { sender, client } = createSender()

        await sender.sendToSession('group:123', 'hi')

        expect(client.sent).toEqual([
            {
                kind: 'group',
                id: 123,
                message: 'hi',
                options: undefined,
            },
        ])
    })

    it('sends to private sessions', async () => {
        const { sender, client } = createSender()

        await sender.sendToSession('private:456', 'hi')

        expect(client.sent[0]?.kind).toBe('private')
        expect(client.sent[0]?.id).toBe(456)
    })

    it('forwards long session messages', async () => {
        const { sender, client } = createSender()

        await sender.sendToSession('group:123', '12345678901')

        expect(client.sent[0]?.kind).toBe('group-forward')
        expect(client.sent[0]?.id).toBe(123)
    })

    it('rejects invalid session ids', async () => {
        const { sender } = createSender()

        await expect(sender.sendToSession('bad', 'hi')).rejects.toThrow(
            /invalid session id/
        )

        await expect(sender.sendToSession('group:0', 'hi')).rejects.toThrow(
            /invalid session id/
        )

        await expect(sender.sendToSession('topic:1', 'hi')).rejects.toThrow(
            /unknown session kind/
        )
    })

    it('logs send failures', async () => {
        const { logger, records } = createCapturingLogger()
        const client = new FakeClient()
        const sender = createMessageSender({
            client,
            message: shortMessageConfig,
            logger,
        })

        await expect(sender.sendToSession('bad', 'hi')).rejects.toThrow()

        expect(records.at(-1)?.level).toBe('error')
    })

    it('targets notices with a group id', async () => {
        const { sender, client } = createSender()
        const event = {
            time: 1,
            self_id: 10000,
            post_type: 'notice',
            notice_type: 'notify',
            group_id: 777,
            user_id: 888,
        } as unknown as SnowLumaEvent
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi')

        expect(context.replies).toHaveLength(0)
        expect(client.sent[0]?.kind).toBe('group')
        expect(client.sent[0]?.id).toBe(777)
    })

    it('targets notices with only a user id', async () => {
        const { sender, client } = createSender()
        const event = {
            time: 1,
            self_id: 10000,
            post_type: 'notice',
            notice_type: 'notify',
            user_id: 888,
        } as unknown as SnowLumaEvent
        const context = new FakeEventContext(event)

        await sender.send(event, context, 'hi')

        expect(client.sent[0]?.kind).toBe('private')
        expect(client.sent[0]?.id).toBe(888)
    })

    it('rejects events without a target', async () => {
        const { sender } = createSender()
        const event = {
            time: 1,
            self_id: 10000,
            post_type: 'meta_event',
            meta_event_type: 'heartbeat',
        } as SnowLumaEvent
        const context = new FakeEventContext(event)

        await expect(sender.send(event, context, 'hi')).rejects.toThrow(
            /cannot determine target/
        )
    })
})
