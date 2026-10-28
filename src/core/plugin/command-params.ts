export type CommandParamType =
    'string' | 'text' | 'number' | 'integer' | 'boolean'

export interface ParsedCommandParams {
    args: unknown[]
    ignored: string[]
}

export interface CompiledCommandParams {
    usage: string
    parse(input: string): ParsedCommandParams
}

export class CommandParamsError extends Error {
    readonly usage: string

    constructor(message: string, usage: string) {
        super(message)
        this.name = 'CommandParamsError'
        this.usage = usage
    }
}

interface ParamSpec {
    name: string
    type: CommandParamType
    required: boolean
    rest: boolean
    hasDefault: boolean
    defaultValue?: unknown
}

interface InputToken {
    value: string
    start: number
}

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_-]*$/u

function declarationError(message: string): Error {
    return new Error(`参数声明错误：${message}`)
}

function parseType(value: string): CommandParamType {
    switch (value) {
        case 'string':
        case 'text':
        case 'number':
        case 'integer':
        case 'boolean':
            return value
        default:
            throw declarationError(`未知的参数类型 "${value}"`)
    }
}

function validateName(value: string): string {
    const name = value.trim()

    if (!name) {
        throw declarationError('参数名不能为空')
    }

    if (!NAME_PATTERN.test(name)) {
        throw declarationError(`非法的参数名 "${name}"`)
    }

    return name
}

function splitDeclaration(input: string): string[] {
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

function unquote(value: string): string {
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

function parseBoolean(value: string): boolean | null {
    const normalized = value.trim().toLowerCase()

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true
    }

    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
        return false
    }

    return null
}

function parseDefaultValue(
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
    }
}

function parseToken(token: string): ParamSpec {
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

function validateSpecs(specs: ParamSpec[]): void {
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

function usageOf(specs: ParamSpec[]): string {
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

function tokenizeInput(input: string, usage: string): InputToken[] {
    const tokens: InputToken[] = []
    let index = 0

    while (index < input.length) {
        const char = input[index]

        if (char === undefined) break

        if (/\s/.test(char)) {
            index += 1
            continue
        }

        const start = index
        let value = ''
        let quote: string | null = null

        while (index < input.length) {
            const current = input[index]

            if (current === undefined) break

            if (quote !== null) {
                if (current === '\\') {
                    const next = input[index + 1]

                    if (next !== undefined) {
                        value += next
                        index += 2
                        continue
                    }

                    value += current
                    index += 1
                    continue
                }

                if (current === quote) {
                    quote = null
                    index += 1
                    continue
                }

                value += current
                index += 1
                continue
            }

            if (/\s/.test(current)) break

            if (current === '"' || current === "'") {
                quote = current
                index += 1
                continue
            }

            if (current === '\\') {
                const next = input[index + 1]

                if (next !== undefined) {
                    value += next
                    index += 2
                    continue
                }

                value += current
                index += 1
                continue
            }

            value += current
            index += 1
        }

        if (quote !== null) {
            throw new CommandParamsError('参数引号未闭合', usage)
        }

        tokens.push({ value, start })
    }

    return tokens
}

function parseValue(spec: ParamSpec, raw: string, usage: string): unknown {
    switch (spec.type) {
        case 'string':
        case 'text':
            return raw
        case 'number': {
            const value = raw.trim() === '' ? Number.NaN : Number(raw)

            if (!Number.isFinite(value)) {
                throw new CommandParamsError(
                    `参数 ${spec.name} 需要是数字`,
                    usage
                )
            }

            return value
        }
        case 'integer': {
            const value = raw.trim() === '' ? Number.NaN : Number(raw)

            if (!Number.isInteger(value)) {
                throw new CommandParamsError(
                    `参数 ${spec.name} 需要是整数`,
                    usage
                )
            }

            return value
        }
        case 'boolean': {
            const value = parseBoolean(raw)

            if (value === null) {
                throw new CommandParamsError(
                    `参数 ${spec.name} 需要是布尔值`,
                    usage
                )
            }

            return value
        }
    }
}

function parseInput(
    specs: ParamSpec[],
    input: string,
    usage: string
): ParsedCommandParams {
    const tokens = tokenizeInput(input, usage)
    const args: unknown[] = []
    let index = 0

    for (const spec of specs) {
        if (spec.rest) {
            for (
                let tokenIndex = index;
                tokenIndex < tokens.length;
                tokenIndex += 1
            ) {
                const token = tokens[tokenIndex]

                if (token) {
                    args.push(token.value)
                }
            }

            index = tokens.length
            continue
        }

        if (spec.type === 'text') {
            const token = tokens[index]

            if (!token) {
                if (spec.hasDefault) {
                    args.push(spec.defaultValue)
                } else if (spec.required) {
                    throw new CommandParamsError(
                        `缺少参数：${spec.name}`,
                        usage
                    )
                } else {
                    args.push(undefined)
                }

                continue
            }

            const remaining = tokens.length - index
            const value =
                remaining === 1 ? token.value : input.slice(token.start).trim()

            args.push(value)
            index = tokens.length
            continue
        }

        const token = tokens[index]

        if (!token) {
            if (spec.hasDefault) {
                args.push(spec.defaultValue)
            } else if (spec.required) {
                throw new CommandParamsError(`缺少参数：${spec.name}`, usage)
            } else {
                args.push(undefined)
            }

            continue
        }

        index += 1
        args.push(parseValue(spec, token.value, usage))
    }

    while (args.length > 0 && args[args.length - 1] === undefined) {
        args.pop()
    }

    const ignored =
        index < tokens.length
            ? tokens.slice(index).map((token) => token.value)
            : []

    return { args, ignored }
}

export function compileCommandParams(
    declaration: string
): CompiledCommandParams {
    const trimmed = declaration.trim()

    if (!trimmed) {
        throw declarationError('参数声明不能为空')
    }

    const specs = splitDeclaration(trimmed).map(parseToken)

    if (specs.length === 0) {
        throw declarationError('参数声明不能为空')
    }

    validateSpecs(specs)

    const usage = usageOf(specs)

    return {
        usage,
        parse(input: string): ParsedCommandParams {
            return parseInput(specs, input, usage)
        },
    }
}
