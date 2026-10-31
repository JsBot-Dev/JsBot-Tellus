import type { OneBotMessageEvent } from '@snowluma/sdk'
import {
    declarationError,
    type CompiledCommandParams,
    type ParsedCommandParams,
} from './types.js'
import {
    splitDeclaration,
    parseToken,
    usageOf,
    validateSpecs,
} from './declaration.js'
import { parseInput } from './input.js'
import { quoteIdOf } from './reply.js'

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
        parse(input: string, event?: OneBotMessageEvent): ParsedCommandParams {
            return parseInput(specs, input, usage, quoteIdOf(event))
        },
    }
}
