import { describe, expect, it } from 'vitest'
import { EventFeed } from '../../src/core/web/event-feed.js'
import { groupMessage, privateMessage } from '../helpers/events.js'

describe('event feed', () => {
    it('summarizes message events', () => {
        const feed = new EventFeed()

        feed.add(groupMessage({ raw_message: 'hello world' }))

        const [entry] = feed.list()

        expect(entry?.type).toBe('message')
        expect(entry?.summary).toContain('hello world')
    })

    it('filters by type and keeps the newest entries', () => {
        const feed = new EventFeed(5)

        feed.add(groupMessage({ raw_message: 'first' }))
        feed.add({
            post_type: 'notice',
            notice_type: 'group_increase',
            time: 1,
            self_id: 1,
            group_id: 1,
            user_id: 2,
        } as never)
        feed.add(privateMessage({ raw_message: 'last' }))

        expect(feed.list({ type: 'message' })).toHaveLength(2)
        expect(feed.list({ type: 'notice' })).toHaveLength(1)
        expect(
            feed.list({ limit: 1 }).map((entry) => entry.summary)
        ).toHaveLength(1)
    })

    it('notifies and unsubscribes listeners', () => {
        const feed = new EventFeed()
        const ids: number[] = []
        const unsubscribe = feed.subscribe((entry) => {
            ids.push(entry.id)
        })

        feed.add(groupMessage())
        feed.add(groupMessage())

        expect(ids).toEqual([1, 2])

        unsubscribe()
        feed.add(groupMessage())

        expect(ids).toEqual([1, 2])
    })
})
