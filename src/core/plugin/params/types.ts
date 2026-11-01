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

export interface ParamSpec {
    name: string
    type: CommandParamType
    required: boolean
    rest: boolean
    hasDefault: boolean
    defaultValue?: unknown
    length?: ParamLength | undefined
}

export interface InputToken {
    value: string
    start: number
}

export function declarationError(message: string): Error {
    return new Error(`参数声明错误：${message}`)
}
