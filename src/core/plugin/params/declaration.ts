import {
    candidateLabel,
    declarationError,
    joinCandidateLabels,
    type CommandParamType,
    type ParamCandidate,
    type ParamLength,
    type ParamSpec,
    type ParamTypeCandidate,
} from './types.js'
import {
    measureLength,
    parseBoolean,
    parseTimeValue,
    unquote,
} from './values.js'

const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_-]*$/u
const LENGTH_PATTERN = /^(\d*)\.\.(\d*)$/

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

function parseLengthNumber(raw: string, token: string): number {
    const value = Number(raw)

    if (!Number.isSafeInteger(value)) {
        throw declarationError(`长度限制不是安全的整数：${token}`)
    }

    return value
}

function parseLength(raw: string, token: string): ParamLength {
    const value = raw.trim()
    const match = LENGTH_PATTERN.exec(value)

    if (!match) {
        throw declarationError(`非法的长度限制 "${raw}"：${token}`)
    }

    const minRaw = match[1] ?? ''
    const maxRaw = match[2] ?? ''

    if (minRaw === '' && maxRaw === '') {
        throw declarationError(`长度限制不能为空：${token}`)
    }

    const min = minRaw === '' ? undefined : parseLengthNumber(minRaw, token)
    const max = maxRaw === '' ? undefined : parseLengthNumber(maxRaw, token)

    if (min !== undefined && max !== undefined && min > max) {
        throw declarationError(`长度下限不能大于上限：${token}`)
    }

    return { min, max }
}

function isQuoted(value: string): boolean {
    const quote = value[0]

    return quote === '"' || quote === "'"
}

function parseLiteral(value: string, token: string): string {
    const quote = value[0]

    if (
        (quote !== '"' && quote !== "'") ||
        value.length < 2 ||
        value[value.length - 1] !== quote
    ) {
        throw declarationError(`非法的字面量 "${value}"：${token}`)
    }

    return unquote(value)
}

function parseBuiltinCandidate(
    value: string,
    token: string
): ParamTypeCandidate {
    const open = value.indexOf('(')

    if (open < 0) {
        return { kind: 'type', type: parseType(value) }
    }

    if (!value.endsWith(')')) {
        throw declarationError(`非法的参数声明 "${token}"`)
    }

    const type = parseType(value.slice(0, open).trim())
    const length = parseLength(value.slice(open + 1, -1), token)

    if (type !== 'string' && type !== 'text') {
        throw declarationError(`只有 string/text 参数支持长度限制：${token}`)
    }

    return { kind: 'type', type, length }
}

function candidateKey(candidate: ParamCandidate): string {
    if (candidate.kind === 'literal') {
        return `literal:${candidate.value}`
    }

    const length = candidate.length
    const range =
        length === undefined ? '' : `${length.min ?? ''}..${length.max ?? ''}`

    return `type:${candidate.type}:${range}`
}

function splitUnion(raw: string, token: string): string[] {
    const parts: string[] = []
    let current = ''
    let quote: string | null = null

    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index]

        if (char === undefined) break

        if (quote !== null) {
            current += char

            if (char === '\\') {
                const next = raw[index + 1]

                if (next !== undefined) {
                    current += next
                    index += 1
                }

                continue
            }

            if (char === quote) {
                quote = null
            }

            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            current += char
            continue
        }

        if (char === '|') {
            parts.push(current)
            current = ''
            continue
        }

        current += char
    }

    if (quote !== null) {
        throw declarationError(`参数 "${token}" 的引号未闭合`)
    }

    parts.push(current)

    return parts
}

function parseCandidates(raw: string, token: string): ParamCandidate[] {
    const candidates: ParamCandidate[] = []
    const seen = new Set<string>()

    for (const part of splitUnion(raw, token)) {
        const value = part.trim()

        if (!value) {
            throw declarationError(`联合类型中存在空的类型：${token}`)
        }

        const candidate = isQuoted(value)
            ? { kind: 'literal' as const, value: parseLiteral(value, token) }
            : parseBuiltinCandidate(value, token)
        const key = candidateKey(candidate)

        if (seen.has(key)) continue

        seen.add(key)
        candidates.push(candidate)
    }

    if (candidates.length > 1) {
        for (const candidate of candidates) {
            if (
                candidate.kind === 'type' &&
                (candidate.type === 'text' || candidate.type === 'reply')
            ) {
                throw declarationError(
                    `${candidate.type} 不能用于联合类型：${token}`
                )
            }
        }
    }

    return candidates
}

function validateDefaultLength(
    name: string,
    value: string,
    length: ParamLength | undefined
): void {
    if (length === undefined) return

    const measured = measureLength(value)

    if (length.min !== undefined && measured < length.min) {
        throw declarationError(
            `参数 ${name} 的默认值至少需要 ${length.min} 个字符`
        )
    }

    if (length.max !== undefined && measured > length.max) {
        throw declarationError(
            `参数 ${name} 的默认值不能超过 ${length.max} 个字符`
        )
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

function hasUnquotedEllipsis(value: string): boolean {
    let quote: string | null = null

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index]

        if (char === undefined) break

        if (quote !== null) {
            if (char === '\\') {
                index += 1
                continue
            }

            if (char === quote) {
                quote = null
            }

            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            continue
        }

        if (value.startsWith('...', index)) {
            return true
        }
    }

    return false
}

function splitDefault(
    inner: string,
    token: string
): { head: string; defaultRaw?: string | undefined } {
    let quote: string | null = null

    for (let index = 0; index < inner.length; index += 1) {
        const char = inner[index]

        if (char === undefined) break

        if (quote !== null) {
            if (char === '\\') {
                index += 1
                continue
            }

            if (char === quote) {
                quote = null
            }

            continue
        }

        if (char === '"' || char === "'") {
            quote = char
            continue
        }

        if (char === '=') {
            return {
                head: inner.slice(0, index).trim(),
                defaultRaw: inner.slice(index + 1).trim(),
            }
        }
    }

    if (quote !== null) {
        throw declarationError(`参数 "${token}" 的引号未闭合`)
    }

    return { head: inner.trim() }
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

        const rest = inner.slice(3)

        if (rest.includes('(')) {
            throw declarationError(`变长参数不支持长度限制：${token}`)
        }

        const name = validateName(rest)

        return {
            name,
            candidates: [{ kind: 'type', type: 'string' }],
            required: false,
            rest: true,
            hasDefault: false,
        }
    }

    const { head, defaultRaw } = splitDefault(inner, token)

    if (hasUnquotedEllipsis(head)) {
        throw declarationError(`非法的参数声明 "${token}"`)
    }

    const colon = head.indexOf(':')
    const name = validateName(colon >= 0 ? head.slice(0, colon) : head)
    const candidates = parseCandidates(
        colon >= 0 ? head.slice(colon + 1) : 'string',
        token
    )

    if (required && defaultRaw !== undefined) {
        throw declarationError(`必填参数不能有默认值：${token}`)
    }

    if (defaultRaw !== undefined) {
        const defaultValue = parseDefaultValue(candidates, defaultRaw, name)

        return {
            name,
            candidates,
            required,
            rest: false,
            hasDefault: true,
            defaultValue,
        }
    }

    return {
        name,
        candidates,
        required,
        rest: false,
        hasDefault: false,
    }
}

function hasTextCandidate(spec: ParamSpec): boolean {
    return spec.candidates.some(
        (candidate) => candidate.kind === 'type' && candidate.type === 'text'
    )
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

        if (hasTextCandidate(spec)) {
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

            const name = hasTextCandidate(spec) ? `${spec.name}...` : spec.name

            return spec.required ? `<${name}>` : `[${name}]`
        })
        .join(' ')
}

function parseDefaultCandidate(
    candidate: ParamCandidate,
    value: string,
    name: string
): unknown {
    if (candidate.kind === 'literal') {
        if (value === candidate.value) {
            return value
        }

        throw declarationError(
            `参数 ${name} 的默认值需要是 ${candidateLabel(candidate)}`
        )
    }

    switch (candidate.type) {
        case 'string':
        case 'text':
            validateDefaultLength(name, value, candidate.length)
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

export function parseDefaultValue(
    candidates: ParamCandidate[],
    raw: string,
    name: string
): unknown {
    const value = unquote(raw)

    if (candidates.length === 1) {
        return parseDefaultCandidate(candidates[0]!, value, name)
    }

    for (const candidate of candidates) {
        try {
            return parseDefaultCandidate(candidate, value, name)
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error
            }
        }
    }

    throw declarationError(
        `参数 ${name} 的默认值需要是 ${joinCandidateLabels(candidates)}`
    )
}
