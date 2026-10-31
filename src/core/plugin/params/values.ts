import { parseSegments } from '@snowluma/sdk'
import { CommandParamsError, declarationError } from './types.js'

export function unquote(value: string): string {
    const trimmed = value.trim()
    const quote = trimmed[0]

    if (quote !== '"' && quote !== "'") {
        return trimmed
    }

    if (trimmed.length < 2 || trimmed[trimmed.length - 1] !== quote) {
        throw declarationError('默认值引号未闭合')
    }

    let result = ''

    for (let index = 1; index < trimmed.length - 1; index += 1) {
        const char = trimmed[index]

        if (char === undefined) break

        if (char === '\\') {
            const next = trimmed[index + 1]

            if (next !== undefined) {
                result += next
                index += 1
            }

            continue
        }

        result += char
    }

    return result
}

export function measureLength(value: string): number {
    return Array.from(value).length
}

export function parseBoolean(value: string): boolean | null {
    const normalized = value.trim().toLowerCase()

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true
    }

    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
        return false
    }

    return null
}

export function parseAt(value: string, name: string, usage: string): number {
    const raw = value.trim()
    const segments = parseSegments(raw)
    const segment = segments[0]

    if (segments.length === 1 && segment?.type === 'at') {
        const qq = segment.data.qq

        if (qq !== 'all') {
            const parsed = Number(qq)

            if (Number.isSafeInteger(parsed) && parsed > 0) {
                return parsed
            }
        }
    } else if (/^\d+$/.test(raw)) {
        const parsed = Number(raw)

        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed
        }
    }

    throw new CommandParamsError(
        `参数 ${name} 需要 @ 一个用户或填写 QQ 号`,
        usage
    )
}

const TIME_UNITS: Record<string, number> = {
    s: 1,
    秒: 1,
    m: 60,
    分: 60,
    分钟: 60,
    h: 3600,
    时: 3600,
    小时: 3600,
    d: 86400,
    天: 86400,
    w: 604800,
    周: 604800,
}

const TIME_PART = /^(\d+(?:\.\d+)?)(分钟|小时|秒|分|时|天|周|[smhdw])/i

export function parseTimeValue(value: string): number | null {
    const raw = value.trim()

    if (/^\d+$/.test(raw)) {
        const seconds = Number(raw)

        return Number.isSafeInteger(seconds) ? seconds : null
    }

    let index = 0
    let total = 0
    let parsed = false

    while (index < raw.length) {
        const match = TIME_PART.exec(raw.slice(index))

        if (!match) return null

        const unit = TIME_UNITS[match[2]?.toLowerCase() ?? '']
        const amount = Number(match[1])

        if (unit === undefined) return null

        total += amount * unit
        index += match[0].length
        parsed = true
    }

    if (!parsed || !Number.isSafeInteger(total) || total < 0) {
        return null
    }

    return total
}

export function parseTime(value: string, name: string, usage: string): number {
    const seconds = parseTimeValue(value)

    if (seconds === null) {
        throw new CommandParamsError(
            `参数 ${name} 需要是时间，例如 10s、5m、1h30m`,
            usage
        )
    }

    return seconds
}
