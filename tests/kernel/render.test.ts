import { describe, expect, it } from 'vitest'
import {
    isTooLong,
    messageText,
    splitReply,
} from '../../src/core/messaging/render.js'

describe('message render', () => {
    const config = { charThreshold: 10, lineThreshold: 2 }

    it('detects long messages by characters', () => {
        expect(isTooLong('1234567890', config)).toBe(false)
        expect(isTooLong('12345678901', config)).toBe(true)
    })

    it('detects long messages by lines', () => {
        expect(isTooLong('a\nb', config)).toBe(false)
        expect(isTooLong('a\nb\nc', config)).toBe(true)
    })

    it('uses CQ string length', () => {
        expect(messageText('hi')).toBe('hi')
    })

    it('splits replies without losing content', () => {
        const parts = splitReply('第一句。第二句。第三句。', 6)

        expect(parts.length).toBeGreaterThan(1)
        expect(parts.every((part) => part.length <= 6)).toBe(true)
        expect(parts.join('')).toBe('第一句。第二句。第三句。')
    })

    it('hard splits a long sentence', () => {
        const parts = splitReply('abcdefghijklmnop', 5)

        expect(parts).toEqual(['abcde', 'fghij', 'klmno', 'p'])
    })

    it('returns no parts for empty text', () => {
        expect(splitReply('   ', 10)).toEqual([])
    })
})
