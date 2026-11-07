import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

export interface JsoncParseResult {
    value: unknown
    error: string | null
}

export function formatParseError(raw: string, error: ParseError): string {
    const before = raw.slice(0, error.offset)
    const line = before.split('\n').length
    const column = error.offset - before.lastIndexOf('\n')

    return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`
}

export function parseJsonc(raw: string): JsoncParseResult {
    const errors: ParseError[] = []
    const text = raw.replace(/^\uFEFF/, '')
    const value = parse(text, errors, {
        allowTrailingComma: true,
        allowEmptyContent: true,
    }) as unknown

    if (errors.length > 0) {
        return {
            value: undefined,
            error: formatParseError(text, errors[0] as ParseError),
        }
    }

    return { value, error: null }
}
