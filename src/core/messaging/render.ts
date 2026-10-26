import { toCQString, type OutgoingMessage } from '@snowluma/sdk'
import type { MessageConfig } from '../config/schema.js'

export function messageText(message: OutgoingMessage): string {
    return toCQString(message)
}

export function isTooLong(
    message: OutgoingMessage,
    config: MessageConfig
): boolean {
    const text = messageText(message)

    return (
        text.length > config.charThreshold ||
        text.split('\n').length > config.lineThreshold
    )
}

function chunkText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let rest = text

    while (rest.length > maxLength) {
        let index = rest.lastIndexOf('\n', maxLength)

        if (index <= 0) {
            index = rest.lastIndexOf('。', maxLength)
        }

        if (index <= 0) {
            index = maxLength
        } else {
            index += 1
        }

        const chunk = rest.slice(0, index).trim()

        if (chunk) chunks.push(chunk)

        rest = rest.slice(index).trimStart()
    }

    if (rest) chunks.push(rest)

    return chunks
}

export function splitReply(text: string, maxLength: number): string[] {
    const normalized = text.replace(/\r\n/g, '\n').trim()

    if (!normalized) return []

    if (normalized.length <= maxLength) return [normalized]

    const sentences = normalized
        .split(/(?<=[。！？；!?;\n])/)
        .map((part) => part.trim())
        .filter(Boolean)

    const result: string[] = []
    let current = ''

    for (const sentence of sentences) {
        const candidate = current ? `${current}${sentence}` : sentence

        if (candidate.length <= maxLength) {
            current = candidate
            continue
        }

        if (current) {
            result.push(current)
            current = ''
        }

        if (sentence.length > maxLength) {
            result.push(...chunkText(sentence, maxLength))
        } else {
            current = sentence
        }
    }

    if (current) result.push(current)

    return result.filter(Boolean)
}
