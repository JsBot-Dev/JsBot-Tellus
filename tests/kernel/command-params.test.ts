import { describe, expect, it } from 'vitest'
import {
    CommandParamsError,
    compileCommandParams,
} from '../../src/core/plugin/command-params.js'

describe('command params', () => {
    it('parses required and optional arguments', () => {
        const params = compileCommandParams(
            '<question:string> [count:number=1]'
        )

        expect(params.usage).toBe('<question> [count]')
        expect(params.parse('hello 3')).toEqual({
            args: ['hello', 3],
            ignored: [],
        })
        expect(params.parse('hello')).toEqual({
            args: ['hello', 1],
            ignored: [],
        })
    })

    it('parses text arguments greedily', () => {
        const params = compileCommandParams('<question:text>')

        expect(params.usage).toBe('<question...>')
        expect(params.parse('今天天气 怎么样')).toEqual({
            args: ['今天天气 怎么样'],
            ignored: [],
        })
        expect(params.parse('"hello world"')).toEqual({
            args: ['hello world'],
            ignored: [],
        })
    })

    it('parses rest arguments', () => {
        const params = compileCommandParams('<first:string> [...rest]')

        expect(params.usage).toBe('<first> [...rest]')
        expect(params.parse('a b c')).toEqual({
            args: ['a', 'b', 'c'],
            ignored: [],
        })
        expect(params.parse('a')).toEqual({
            args: ['a'],
            ignored: [],
        })
    })

    it('supports quoted fixed arguments', () => {
        const params = compileCommandParams('<name:string> <message:text>')

        expect(params.parse('"Alice Smith" hello world')).toEqual({
            args: ['Alice Smith', 'hello world'],
            ignored: [],
        })
    })

    it('ignores extra arguments', () => {
        const params = compileCommandParams('<question:string>')

        expect(params.parse('hello world extra')).toEqual({
            args: ['hello'],
            ignored: ['world', 'extra'],
        })
    })

    it('keeps missing optional arguments before defaults', () => {
        const params = compileCommandParams(
            '<first:string> [second:string] [count:number=3]'
        )

        expect(params.parse('x')).toEqual({
            args: ['x', undefined, 3],
            ignored: [],
        })
        expect(params.parse('x y')).toEqual({
            args: ['x', 'y', 3],
            ignored: [],
        })
    })

    it('trims missing trailing optional arguments', () => {
        const params = compileCommandParams('<first:string> [second:string]')

        expect(params.parse('x')).toEqual({
            args: ['x'],
            ignored: [],
        })
    })

    it('parses numbers, integers and booleans', () => {
        const params = compileCommandParams(
            '<amount:number> <count:integer> <enabled:boolean>'
        )

        expect(params.parse('1.5 3 yes')).toEqual({
            args: [1.5, 3, true],
            ignored: [],
        })
        expect(params.parse('1.5 3 off')).toEqual({
            args: [1.5, 3, false],
            ignored: [],
        })
    })

    it('reports missing and invalid arguments with usage', () => {
        const params = compileCommandParams(
            '<question:string> [count:number=1]'
        )

        expect(() => params.parse('')).toThrowError(
            new CommandParamsError('缺少参数：question', '<question> [count]')
        )

        try {
            params.parse('hello abc')
            throw new Error('expected parse to fail')
        } catch (error) {
            expect(error).toBeInstanceOf(CommandParamsError)
            expect((error as CommandParamsError).message).toBe(
                '参数 count 需要是数字'
            )
            expect((error as CommandParamsError).usage).toBe(
                '<question> [count]'
            )
        }
    })

    it('accepts optional text arguments', () => {
        const params = compileCommandParams('[question:text]')

        expect(params.parse('')).toEqual({
            args: [],
            ignored: [],
        })
        expect(params.parse('hello world')).toEqual({
            args: ['hello world'],
            ignored: [],
        })
    })

    it('rejects invalid declarations', () => {
        expect(() => compileCommandParams('')).toThrow(/参数声明不能为空/)
        expect(() => compileCommandParams('<arg')).toThrow(/缺少 >/)
        expect(() => compileCommandParams('<arg:unknown>')).toThrow(
            /未知的参数类型/
        )
        expect(() => compileCommandParams('<arg=1>')).toThrow(
            /必填参数不能有默认值/
        )
        expect(() =>
            compileCommandParams('<arg> [optional] <required>')
        ).toThrow(/必填参数不能出现在可选参数后面/)
        expect(() => compileCommandParams('<text:text> <arg>')).toThrow(
            /文本参数必须放在最后/
        )
        expect(() => compileCommandParams('[...rest] <arg>')).toThrow(
            /变长参数必须放在最后/
        )
        expect(() => compileCommandParams('<arg> <arg>')).toThrow(/参数名重复/)
        expect(() => compileCommandParams('[arg:integer=1.5]')).toThrow(
            /默认值不是整数/
        )
        expect(() => compileCommandParams('[arg:boolean=maybe]')).toThrow(
            /默认值不是布尔值/
        )
    })
})
