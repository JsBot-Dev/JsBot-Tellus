import { describe, expect, it } from 'vitest'
import { appConfigSchema } from '../../src/core/config/schema.js'
import { Kernel } from '../../src/core/kernel.js'
import { openMemoryDatabase } from '../../src/core/storage/database.js'
import { FakeClient } from '../helpers/fake-client.js'
import { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage } from '../helpers/events.js'
import { createTestLogger } from '../helpers/loggers.js'

describe('kernel event tap', () => {
    it('observes accepted events and ignores tap failures', async () => {
        const client = new FakeClient()
        const database = openMemoryDatabase()
        const seen: string[] = []
        const kernel = new Kernel({
            config: appConfigSchema.parse({}),
            client,
            database,
            logger: createTestLogger('kernel'),
            onEvent: () => {
                seen.push('event')
                throw new Error('tap failure')
            },
        })

        await kernel.start()

        const event = groupMessage({ raw_message: 'hello' })
        await client.dispatch(event, new FakeEventContext(event))

        expect(seen).toEqual(['event'])

        await kernel.stop()
    })

    it('does not observe events while paused', async () => {
        const client = new FakeClient()
        const database = openMemoryDatabase()
        let count = 0
        const kernel = new Kernel({
            config: appConfigSchema.parse({}),
            client,
            database,
            logger: createTestLogger('kernel'),
            onEvent: () => {
                count += 1
            },
        })

        await kernel.start()
        kernel.pause()

        const event = groupMessage()
        await client.dispatch(event, new FakeEventContext(event))

        expect(count).toBe(0)

        await kernel.stop()
    })
})
