import type { OneBotMessageEvent } from '@snowluma/sdk'

export type CommandParamType =
    | 'string'
    | 'text'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'at'
    | 'reply'
    | 'time'

export interface ParsedCommandParams {
    args: unknown[]
    ignored: string[]
}

export interface CompiledCommandParams {
    usage: string
    parse(input: string, event?: OneBotMessageEvent): ParsedCommandParams
}

export class CommandParamsError extends Error {
    readonly usage: string

    constructor(message: string, usage: string) {
        super(message)
        this.name = 'CommandParamsError'
        this.usage = usage
    }
}

export interface ParamLength {
    min?: number | undefined
    max?: number | undefined
}

export interface ParamTypeCandidate {
    kind: 'type'
    type: CommandParamType
    length?: ParamLength | undefined
}

export interface ParamLiteralCandidate {
    kind: 'literal'
    value: string
}

export type ParamCandidate = ParamTypeCandidate | ParamLiteralCandidate

export interface ParamSpec {
    name: string
    candidates: ParamCandidate[]
    required: boolean
    rest: boolean
    hasDefault: boolean
    defaultValue?: unknown
}

export interface InputToken {
    value: string
    start: number
}

export function declarationError(message: string): Error {
    return new Error(`参数声明错误：${message}`)
}

export function candidateLabel(candidate: ParamCandidate): string {
    if (candidate.kind === 'literal') {
        const escaped = candidate.value
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")

        return `'${escaped}'`
    }

    const length = candidate.length

    if (length === undefined) {
        return candidate.type
    }

    return `${candidate.type}(${length.min ?? ''}..${length.max ?? ''})`
}

export function joinCandidateLabels(
    candidates: readonly ParamCandidate[]
): string {
    const labels = candidates.map(candidateLabel)

    if (labels.length === 0) return ''

    if (labels.length === 1) return labels[0] ?? ''

    const last = labels[labels.length - 1] ?? ''

    return `${labels.slice(0, -1).join('、')} 或 ${last}`
}
