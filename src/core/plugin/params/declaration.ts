import {
    declarationError,
    type CommandParamType,
    type ParamSpec,
} from './types.js'
import { parseBoolean, parseTimeValue, unquote } from './values.js'

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_-]*$/u

export function parseType(value: string): CommandParamType {
    switch (value) {
        case 'string':
        case 'text':
        case 'number':
        case 'integer':
        case 'boolean':
        case 'at':
        case 'reply':
        case 'time':
            return value
        default:
            throw declarationError(`未知的参数类型 "${value}"`)
    }
}

export function validateName(value: string): string {
    const name = value.trim()

    if (!name) {
        throw declarationError('参数名不能为空')
    }

    if (!NAME_PATTERN.test(name)) {
        throw declarationError(`非法的参数名 "${name}"`)
    }

    return name
}

export function splitDeclaration(input: string): string[] {
    const parts: string[] = []
    let index = 0

    while (index < input.length) {
        const char = input[index]

        if (char === undefined) break

        if (/\s/.test(char)) {
            index += 1
            continue
        }

        if (char !== '<' && char !== '[') {
            throw declarationError(`无法识别的字符 "${char}"`)
        }

        const close = char === '<' ? '>' : ']'
        let end = index + 1
        let quote: string | null = null

        for (; end < input.length; end += 1) {
            const current = input[end]

            if (current === undefined) break

            if (quote !== null) {
                if (current === '\\') {
                    end += 1
                    continue
                }

                if (current === quote) {
                    quote = null
                }

                continue
            }

            if (current === '"' || current === "'") {
                quote = current
                continue
            }

            if (current === close) break
        }

        if (end >= input.length || input[end] !== close) {
            throw declarationError(`参数 "${input.slice(index)}" 缺少 ${close}`)
        }

        parts.push(input.slice(index, end + 1))
        index = end + 1
    }

    return parts
}

export function parseToken(token: string): ParamSpec {
    const open = token[0]
    const close = token[token.length - 1]

    if (
        (open !== '<' && open !== '[') ||
        (close !== '>' && close !== ']') ||
        (open === '<') !== (close === '>')
    ) {
        throw declarationError(`非法的参数声明 "${token}"`)
    }

    const required = open === '<'
    const inner = token.slice(1, -1).trim()

    if (!inner) {
        throw declarationError('参数名不能为空')
    }

    if (inner.startsWith('...')) {
        if (required) {
            throw declarationError('变长参数必须使用 [ ]')
        }

        const name = validateName(inner.slice(3))

        return {
            name,
            type: 'string',
            required: false,
            rest: true,
            hasDefault: false,
        }
    }

    if (inner.includes('...')) {
        throw declarationError(`非法的参数声明 "${token}"`)
    }

    const equals = inner.indexOf('=')
    const head = equals >= 0 ? inner.slice(0, equals).trim() : inner.trim()
    const defaultRaw = equals >= 0 ? inner.slice(equals + 1).trim() : undefined
    const colon = head.indexOf(':')
    const name = validateName(colon >= 0 ? head.slice(0, colon) : head)
    const type = parseType(colon >= 0 ? head.slice(colon + 1).trim() : 'string')

    if (required && defaultRaw !== undefined) {
        throw declarationError(`必填参数不能有默认值：${token}`)
    }

    if (defaultRaw !== undefined) {
        return {
            name,
            type,
            required,
            rest: false,
            hasDefault: true,
            defaultValue: parseDefaultValue(type, defaultRaw, name),
        }
    }

    return {
        name,
        type,
        required,
        rest: false,
        hasDefault: false,
    }
}

export function validateSpecs(specs: ParamSpec[]): void {
    const names = new Set<string>()
    let seenOptional = false
    let seenRest = false
    let seenText = false

    for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index]

        if (!spec) continue

        if (names.has(spec.name)) {
            throw declarationError(`参数名重复 "${spec.name}"`)
        }

        names.add(spec.name)

        if (seenRest) {
            throw declarationError('变长参数后面不能再有参数')
        }

        if (seenText) {
            throw declarationError('文本参数后面不能再有参数')
        }

        if (spec.rest) {
            if (index !== specs.length - 1) {
                throw declarationError('变长参数必须放在最后')
            }

            seenRest = true
            continue
        }

        if (spec.type === 'text') {
            if (index !== specs.length - 1) {
                throw declarationError('文本参数必须放在最后')
            }

            seenText = true
        }

        if (spec.required) {
            if (seenOptional) {
                throw declarationError('必填参数不能出现在可选参数后面')
            }
        } else {
            seenOptional = true
        }
    }
}

export function usageOf(specs: ParamSpec[]): string {
    return specs
        .map((spec) => {
            if (spec.rest) {
                return `[...${spec.name}]`
            }

            const name = spec.type === 'text' ? `${spec.name}...` : spec.name

            return spec.required ? `<${name}>` : `[${name}]`
        })
        .join(' ')
}

export function parseDefaultValue(
    type: CommandParamType,
    raw: string,
    name: string
): unknown {
    const value = unquote(raw)

    switch (type) {
        case 'string':
        case 'text':
            return value
        case 'number': {
            const number = value.trim() === '' ? Number.NaN : Number(value)

            if (!Number.isFinite(number)) {
                throw declarationError(`参数 ${name} 的默认值不是数字`)
            }

            return number
        }
        case 'integer': {
            const number = value.trim() === '' ? Number.NaN : Number(value)

            if (!Number.isInteger(number)) {
                throw declarationError(`参数 ${name} 的默认值不是整数`)
            }

            return number
        }
        case 'boolean': {
            const boolean = parseBoolean(value)

            if (boolean === null) {
                throw declarationError(`参数 ${name} 的默认值不是布尔值`)
            }

            return boolean
        }
        case 'at':
        case 'reply':
            throw declarationError(`参数 ${name} 不支持默认值`)
        case 'time': {
            const seconds = parseTimeValue(value)

            if (seconds === null) {
                throw declarationError(`参数 ${name} 的默认值不是时间`)
            }

            return seconds
        }
    }
}
