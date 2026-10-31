import { describe, expect, it } from 'vitest'
import {
    CommandParamsError,
    compileCommandParams,
} from '../../src/core/plugin/command-params.js'
import { groupMessage } from '../helpers/events.js'

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

    it('limits string lengths', () => {
        const max = compileCommandParams('<name:string(..3)>')

        expect(max.usage).toBe('<name>')
        expect(max.parse('abc')).toEqual({ args: ['abc'], ignored: [] })
        expect(() => max.parse('abcd')).toThrowError(
            new CommandParamsError('参数 name 不能超过 3 个字符', '<name>')
        )

        const min = compileCommandParams('[name:string(2..)]')

        expect(min.parse('ab')).toEqual({ args: ['ab'], ignored: [] })
        expect(() => min.parse('a')).toThrowError(
            new CommandParamsError('参数 name 至少需要 2 个字符', '[name]')
        )

        const range = compileCommandParams('<name:string(2..3)>')

        expect(range.parse('ab')).toEqual({ args: ['ab'], ignored: [] })
        expect(range.parse('abc')).toEqual({ args: ['abc'], ignored: [] })
        expect(() => range.parse('a')).toThrowError(
            new CommandParamsError('参数 name 至少需要 2 个字符', '<name>')
        )
        expect(() => range.parse('abcd')).toThrowError(
            new CommandParamsError('参数 name 不能超过 3 个字符', '<name>')
        )
    })

    it('limits text lengths', () => {
        const params = compileCommandParams('<message:text(2..5)>')

        expect(params.usage).toBe('<message...>')
        expect(params.parse('hello')).toEqual({
            args: ['hello'],
            ignored: [],
        })
        expect(params.parse('"你好"')).toEqual({
            args: ['你好'],
            ignored: [],
        })
        expect(() => params.parse('a')).toThrowError(
            new CommandParamsError(
                '参数 message 至少需要 2 个字符',
                '<message...>'
            )
        )
        expect(() => params.parse('hello world')).toThrowError(
            new CommandParamsError(
                '参数 message 不能超过 5 个字符',
                '<message...>'
            )
        )
    })

    it('counts lengths in unicode code points', () => {
        const params = compileCommandParams('<name:string(..1)>')

        expect(params.parse('😀')).toEqual({ args: ['😀'], ignored: [] })
        expect(() => params.parse('😀😀')).toThrowError(
            new CommandParamsError('参数 name 不能超过 1 个字符', '<name>')
        )
    })

    it('validates default lengths when compiling', () => {
        const params = compileCommandParams('[name:string(2..3)=ab]')

        expect(params.parse('')).toEqual({ args: ['ab'], ignored: [] })
        expect(() => compileCommandParams('[name:string(2..3)=a]')).toThrow(
            /参数 name 的默认值至少需要 2 个字符/
        )
        expect(() => compileCommandParams('[name:string(2..3)=abcd]')).toThrow(
            /参数 name 的默认值不能超过 3 个字符/
        )
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

    it('parses time durations as seconds', () => {
        const params = compileCommandParams('<time:time> [fallback:time=1m]')

        expect(params.usage).toBe('<time> [fallback]')
        expect(params.parse('60')).toEqual({
            args: [60, 60],
            ignored: [],
        })
        expect(params.parse('10s')).toEqual({
            args: [10, 60],
            ignored: [],
        })
        expect(params.parse('5m')).toEqual({
            args: [300, 60],
            ignored: [],
        })
        expect(params.parse('1.5h')).toEqual({
            args: [5400, 60],
            ignored: [],
        })
        expect(params.parse('1h30m')).toEqual({
            args: [5400, 60],
            ignored: [],
        })
        expect(params.parse('2d')).toEqual({
            args: [172800, 60],
            ignored: [],
        })
        expect(params.parse('1w')).toEqual({
            args: [604800, 60],
            ignored: [],
        })
        expect(params.parse('10分钟')).toEqual({
            args: [600, 60],
            ignored: [],
        })
        expect(params.parse('1小时30分钟')).toEqual({
            args: [5400, 60],
            ignored: [],
        })
    })

    it('uses time defaults', () => {
        const params = compileCommandParams('[delay:time=30s]')

        expect(params.parse('')).toEqual({
            args: [30],
            ignored: [],
        })
    })

    it('rejects invalid time arguments', () => {
        const params = compileCommandParams('<time:time>')

        for (const value of ['abc', '-1', '1x', '1h30', '0.1s']) {
            expect(() => params.parse(value)).toThrowError(
                new CommandParamsError(
                    '参数 time 需要是时间，例如 10s、5m、1h30m',
                    '<time>'
                )
            )
        }
    })

    it('parses at arguments from CQ codes or QQ numbers', () => {
        const params = compileCommandParams('<user:at> <time:integer>')

        expect(params.usage).toBe('<user> <time>')
        expect(params.parse('[CQ:at,qq=123456] 60')).toEqual({
            args: [123456, 60],
            ignored: [],
        })
        expect(params.parse('123456 60')).toEqual({
            args: [123456, 60],
            ignored: [],
        })
        expect(params.parse('[CQ:at,qq=123456,name=Alice Smith] 60')).toEqual({
            args: [123456, 60],
            ignored: [],
        })
    })

    it('rejects invalid at arguments', () => {
        const params = compileCommandParams('<user:at>')

        expect(() => params.parse('[CQ:at,qq=all]')).toThrowError(
            new CommandParamsError(
                '参数 user 需要 @ 一个用户或填写 QQ 号',
                '<user>'
            )
        )

        expect(() => params.parse('alice')).toThrowError(
            new CommandParamsError(
                '参数 user 需要 @ 一个用户或填写 QQ 号',
                '<user>'
            )
        )
    })

    it('accepts optional at arguments', () => {
        const params = compileCommandParams('[user:at]')

        expect(params.parse('')).toEqual({
            args: [],
            ignored: [],
        })
        expect(params.parse('[CQ:at,qq=123456]')).toEqual({
            args: [123456],
            ignored: [],
        })
    })

    it('reads reply arguments from the quoted message', () => {
        const params = compileCommandParams('<message:reply> <reason:string>')

        expect(params.usage).toBe('<message> <reason>')
        expect(
            params.parse(
                'spam',
                groupMessage({
                    message: [{ type: 'reply', data: { id: '123456' } }],
                })
            )
        ).toEqual({
            args: [123456, 'spam'],
            ignored: [],
        })

        const single = compileCommandParams('<message:reply>')

        expect(
            single.parse('', groupMessage({ message: '[CQ:reply,id=654321]' }))
        ).toEqual({
            args: [654321],
            ignored: [],
        })
        expect(
            single.parse(
                '',
                groupMessage({
                    message: [],
                    raw_message: '[CQ:reply,id=777] /recall',
                })
            )
        ).toEqual({
            args: [777],
            ignored: [],
        })
    })

    it('rejects missing reply arguments', () => {
        const params = compileCommandParams('<message:reply>')

        expect(() => params.parse('')).toThrowError(
            new CommandParamsError('参数 message 需要引用一条消息', '<message>')
        )
    })

    it('accepts optional reply arguments', () => {
        const params = compileCommandParams('[message:reply]')

        expect(params.parse('')).toEqual({
            args: [],
            ignored: [],
        })
        expect(
            params.parse(
                '',
                groupMessage({
                    message: [{ type: 'reply', data: { id: 123456 } }],
                })
            )
        ).toEqual({
            args: [123456],
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
        expect(() => compileCommandParams('[arg:at=123456]')).toThrow(
            /不支持默认值/
        )
        expect(() => compileCommandParams('[arg:reply=123456]')).toThrow(
            /不支持默认值/
        )
        expect(() => compileCommandParams('[arg:time=abc]')).toThrow(
            /默认值不是时间/
        )
        expect(() => compileCommandParams('<arg:number(1..2)>')).toThrow(
            /只有 string\/text 参数支持长度限制/
        )
        expect(() => compileCommandParams('<arg:string(..)>')).toThrow(
            /长度限制不能为空/
        )
        expect(() => compileCommandParams('<arg:string(3..2)>')).toThrow(
            /长度下限不能大于上限/
        )
        expect(() => compileCommandParams('<arg:string(-1..2)>')).toThrow(
            /非法的长度限制/
        )
        expect(() => compileCommandParams('<arg:string(1.5..2)>')).toThrow(
            /非法的长度限制/
        )
        expect(() => compileCommandParams('<arg:string(1...2)>')).toThrow(
            /非法的参数声明/
        )
        expect(() => compileCommandParams('<arg:string(1..2>')).toThrow(
            /非法的参数声明/
        )
        expect(() => compileCommandParams('[...rest(1..2)]')).toThrow(
            /变长参数不支持长度限制/
        )
    })
})
