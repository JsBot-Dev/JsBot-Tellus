import { describe, expect, it } from 'vitest'
import {
    CommandParamsError,
    compileCommandParams,
} from '../../src/core/plugin/command-params.js'

describe('command param unions', () => {
    it('tries built-in types in declaration order', () => {
        const stringFirst = compileCommandParams('<value:string|integer>')

        expect(stringFirst.usage).toBe('<value>')
        expect(stringFirst.parse('123')).toEqual({
            args: ['123'],
            ignored: [],
        })
        expect(stringFirst.parse('abc')).toEqual({
            args: ['abc'],
            ignored: [],
        })

        const integerFirst = compileCommandParams('<value:integer|string>')

        expect(integerFirst.parse('123')).toEqual({
            args: [123],
            ignored: [],
        })
        expect(integerFirst.parse('abc')).toEqual({
            args: ['abc'],
            ignored: [],
        })
    })

    it('tries literal values in declaration order', () => {
        const params = compileCommandParams("<mode:'fast'|'slow'>")

        expect(params.usage).toBe('<mode>')
        expect(params.parse('fast')).toEqual({
            args: ['fast'],
            ignored: [],
        })
        expect(params.parse('slow')).toEqual({
            args: ['slow'],
            ignored: [],
        })
        expect(() => params.parse('FAST')).toThrowError(
            new CommandParamsError(
                "参数 mode 需要是 'fast' 或 'slow'",
                '<mode>'
            )
        )
    })

    it('supports mixed built-in and literal candidates', () => {
        const params = compileCommandParams("<value:integer|'none'>")

        expect(params.parse('12')).toEqual({
            args: [12],
            ignored: [],
        })
        expect(params.parse('none')).toEqual({
            args: ['none'],
            ignored: [],
        })
        expect(() => params.parse('other')).toThrowError(
            new CommandParamsError(
                "参数 value 需要是 integer 或 'none'",
                '<value>'
            )
        )
    })

    it('supports a single literal candidate', () => {
        const params = compileCommandParams("<mode:'fast'>")

        expect(params.parse('fast')).toEqual({
            args: ['fast'],
            ignored: [],
        })
        expect(() => params.parse('slow')).toThrowError(
            new CommandParamsError("参数 mode 需要是 'fast'", '<mode>')
        )
    })

    it('supports literals with special characters', () => {
        const spaced = compileCommandParams("<name:'hello world'|'bye'>")

        expect(spaced.parse('"hello world"')).toEqual({
            args: ['hello world'],
            ignored: [],
        })

        const piped = compileCommandParams("<value:'a|b'|'c'>")

        expect(piped.parse('"a|b"')).toEqual({
            args: ['a|b'],
            ignored: [],
        })

        const symbols = compileCommandParams("<value:'a=b:c'|'d'>")

        expect(symbols.parse('"a=b:c"')).toEqual({
            args: ['a=b:c'],
            ignored: [],
        })

        const escaped = compileCommandParams("<value:'a\\'b'|'c'>")

        expect(escaped.parse('"a\'b"')).toEqual({
            args: ["a'b"],
            ignored: [],
        })

        const bracketed = compileCommandParams("<value:'a>b'|'c'>")

        expect(bracketed.parse('"a>b"')).toEqual({
            args: ['a>b'],
            ignored: [],
        })

        const optionalBracketed = compileCommandParams("[value:'a]b'|'c']")

        expect(optionalBracketed.parse('"a]b"')).toEqual({
            args: ['a]b'],
            ignored: [],
        })
    })

    it('supports optional unions and defaults', () => {
        const optional = compileCommandParams("[mode:'fast'|'slow']")

        expect(optional.parse('')).toEqual({
            args: [],
            ignored: [],
        })
        expect(optional.parse('slow')).toEqual({
            args: ['slow'],
            ignored: [],
        })

        const literalDefault = compileCommandParams(
            "[mode:'fast'|'slow'='fast']"
        )

        expect(literalDefault.parse('')).toEqual({
            args: ['fast'],
            ignored: [],
        })
        expect(literalDefault.parse('slow')).toEqual({
            args: ['slow'],
            ignored: [],
        })

        const builtinDefault = compileCommandParams('[value:integer|boolean=1]')

        expect(builtinDefault.parse('')).toEqual({
            args: [1],
            ignored: [],
        })
        expect(builtinDefault.parse('true')).toEqual({
            args: [true],
            ignored: [],
        })

        const symbolDefault = compileCommandParams("[value:'a=b'|'c'='a=b']")

        expect(symbolDefault.parse('')).toEqual({
            args: ['a=b'],
            ignored: [],
        })

        const atDefault = compileCommandParams('[target:at|string=alice]')

        expect(atDefault.parse('')).toEqual({
            args: ['alice'],
            ignored: [],
        })
    })

    it('rejects defaults that match no candidate', () => {
        expect(() =>
            compileCommandParams("[mode:'fast'|'slow'='medium']")
        ).toThrow(/参数 mode 的默认值需要是 'fast' 或 'slow'/)
    })

    it('supports length restrictions in unions', () => {
        const params = compileCommandParams('<name:string(2..3)|integer>')

        expect(params.parse('12')).toEqual({
            args: ['12'],
            ignored: [],
        })
        expect(() => params.parse('abcd')).toThrowError(
            new CommandParamsError(
                '参数 name 需要是 string(2..3) 或 integer',
                '<name>'
            )
        )

        const integerFirst = compileCommandParams('<name:integer|string(2..3)>')

        expect(integerFirst.parse('12')).toEqual({
            args: [12],
            ignored: [],
        })
    })

    it('supports at in unions', () => {
        const atFirst = compileCommandParams('<target:at|string>')

        expect(atFirst.parse('[CQ:at,qq=123456]')).toEqual({
            args: [123456],
            ignored: [],
        })
        expect(atFirst.parse('alice')).toEqual({
            args: ['alice'],
            ignored: [],
        })

        const stringFirst = compileCommandParams('<target:string|at>')

        expect(stringFirst.parse('123456')).toEqual({
            args: ['123456'],
            ignored: [],
        })
    })

    it('rejects text and reply in unions', () => {
        expect(() => compileCommandParams('<value:string|text>')).toThrow(
            /text 不能用于联合类型/
        )
        expect(() => compileCommandParams('<value:reply|string>')).toThrow(
            /reply 不能用于联合类型/
        )
    })

    it('rejects malformed unions', () => {
        expect(() => compileCommandParams('<value:string|>')).toThrow(
            /联合类型中存在空的类型/
        )
        expect(() => compileCommandParams('<value:|integer>')).toThrow(
            /联合类型中存在空的类型/
        )
        expect(() => compileCommandParams('<value:string||integer>')).toThrow(
            /联合类型中存在空的类型/
        )
        expect(() => compileCommandParams('<value:string|unknown>')).toThrow(
            /未知的参数类型 "unknown"/
        )
        expect(() => compileCommandParams("<value:'fast>")).toThrow(/缺少 >/)
    })
})
