import {
    candidateLabel,
    CommandParamsError,
    joinCandidateLabels,
    type InputToken,
    type ParamCandidate,
    type ParamLength,
    type ParamSpec,
    type ParsedCommandParams,
} from './types.js'
import { measureLength, parseAt, parseBoolean, parseTime } from './values.js'

export function tokenizeInput(input: string, usage: string): InputToken[] {
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

            if (current === '[' && input.startsWith('[CQ:', index)) {
                const close = input.indexOf(']', index + 4)

                if (close >= 0) {
                    value += input.slice(index, close + 1)
                    index = close + 1
                    continue
                }
            }

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

function enforceLength(
    name: string,
    length: ParamLength | undefined,
    value: string,
    usage: string
): string {
    if (length === undefined) {
        return value
    }

    const measured = measureLength(value)

    if (length.min !== undefined && measured < length.min) {
        throw new CommandParamsError(
            `参数 ${name} 至少需要 ${length.min} 个字符`,
            usage
        )
    }

    if (length.max !== undefined && measured > length.max) {
        throw new CommandParamsError(
            `参数 ${name} 不能超过 ${length.max} 个字符`,
            usage
        )
    }

    return value
}

function parseCandidate(
    candidate: ParamCandidate,
    spec: ParamSpec,
    raw: string,
    usage: string
): unknown {
    if (candidate.kind === 'literal') {
        if (raw === candidate.value) {
            return raw
        }

        throw new CommandParamsError(
            `参数 ${spec.name} 需要是 ${candidateLabel(candidate)}`,
            usage
        )
    }

    switch (candidate.type) {
        case 'string':
        case 'text':
            return enforceLength(spec.name, candidate.length, raw, usage)
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
        case 'at':
            return parseAt(raw, spec.name, usage)
        case 'reply':
            throw new CommandParamsError(
                `参数 ${spec.name} 需要引用一条消息`,
                usage
            )
        case 'time':
            return parseTime(raw, spec.name, usage)
    }
}

export function parseValue(
    spec: ParamSpec,
    raw: string,
    usage: string
): unknown {
    if (spec.candidates.length === 1) {
        return parseCandidate(spec.candidates[0]!, spec, raw, usage)
    }

    for (const candidate of spec.candidates) {
        try {
            return parseCandidate(candidate, spec, raw, usage)
        } catch (error) {
            if (!(error instanceof CommandParamsError)) {
                throw error
            }
        }
    }

    throw new CommandParamsError(
        `参数 ${spec.name} 需要是 ${joinCandidateLabels(spec.candidates)}`,
        usage
    )
}

export function parseInput(
    specs: ParamSpec[],
    input: string,
    usage: string,
    quoteId: number | undefined
): ParsedCommandParams {
    const tokens = tokenizeInput(input, usage)
    const args: unknown[] = []
    let index = 0

    for (const spec of specs) {
        const sole =
            spec.candidates.length === 1 ? spec.candidates[0] : undefined

        if (sole?.kind === 'type' && sole.type === 'reply') {
            if (quoteId !== undefined) {
                args.push(quoteId)
            } else if (spec.required) {
                throw new CommandParamsError(
                    `参数 ${spec.name} 需要引用一条消息`,
                    usage
                )
            } else {
                args.push(undefined)
            }

            continue
        }

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

        if (sole?.kind === 'type' && sole.type === 'text') {
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

            args.push(enforceLength(spec.name, sole.length, value, usage))
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
