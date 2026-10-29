import { describe, expectTypeOf, it } from 'vitest'
import type { OneBotMessageEvent } from '@snowluma/sdk'
import type { CommandParamArgs } from '../../src/core/plugin/command-params.js'
import type {
    CommandHandler,
    CommandRegistrar,
} from '../../src/core/plugin/types.js'

declare const commands: CommandRegistrar
declare const dynamicParams: string

const askParams = '<question:string> [count:integer=1]'

function checkRegisterInference(): void {
    commands.register(
        {
            name: 'ask',
            params: '<question:string> [count:integer=1]',
        },
        async (_event, _context, _match, question, count) => {
            expectTypeOf(question).toEqualTypeOf<string>()
            expectTypeOf(count).toEqualTypeOf<number>()
        }
    )

    commands.register(
        {
            name: 'const-params',
            params: askParams,
        },
        async (_event, _context, _match, question, count) => {
            expectTypeOf(question).toEqualTypeOf<string>()
            expectTypeOf(count).toEqualTypeOf<number>()
        }
    )

    commands.register(
        {
            name: 'annotated',
            params: '<question:string> [count:integer=1]',
        },
        async (_event, _context, _match, question: string, count: number) => {
            void question
            void count
        }
    )

    commands.register(
        {
            name: 'rest',
            params: '<first:string> [...rest]',
        },
        async (_event, _context, _match, first, ...rest) => {
            expectTypeOf(first).toEqualTypeOf<string>()
            expectTypeOf(rest).toEqualTypeOf<string[]>()
        }
    )

    commands.register(
        {
            name: 'optional',
            params: '[name:string]',
        },
        async (_event, _context, _match, name) => {
            expectTypeOf(name).toEqualTypeOf<string | undefined>()
        }
    )

    commands.register(
        {
            name: 'at',
            params: '<user:at> [other:at]',
        },
        async (_event, _context, _match, user, other) => {
            expectTypeOf(user).toEqualTypeOf<number>()
            expectTypeOf(other).toEqualTypeOf<number | undefined>()
        }
    )

    commands.register(
        {
            name: 'plain',
        },
        async (_event, _context, _match) => {}
    )

    commands.register(
        {
            name: 'dynamic',
            params: dynamicParams,
        },
        async (_event, _context, _match, ...args) => {
            expectTypeOf(args).toEqualTypeOf<any[]>()
        }
    )

    commands.group(
        {
            name: 'demo',
            params: '<target:string>',
            handler: async (_event, _context, _match, target) => {
                expectTypeOf(target).toEqualTypeOf<string>()
            },
        },
        () => {}
    )
}

void checkRegisterInference

describe('command param type inference', () => {
    it('maps declarations to handler argument tuples', () => {
        expectTypeOf<
            CommandParamArgs<'<question:string> [count:integer=1]'>
        >().toEqualTypeOf<[string, number]>()

        expectTypeOf<CommandParamArgs<'<message:text>'>>().toEqualTypeOf<
            [string]
        >()

        expectTypeOf<
            CommandParamArgs<'<first:string> [...rest]'>
        >().toEqualTypeOf<[string, ...string[]]>()

        expectTypeOf<CommandParamArgs<'[...rest]'>>().toEqualTypeOf<
            [...string[]]
        >()

        expectTypeOf<CommandParamArgs<'[name:string]'>>().toEqualTypeOf<
            [string | undefined]
        >()

        expectTypeOf<CommandParamArgs<'[message:text]'>>().toEqualTypeOf<
            [string | undefined]
        >()

        expectTypeOf<
            CommandParamArgs<'<amount:number> <enabled:boolean>'>
        >().toEqualTypeOf<[number, boolean]>()

        expectTypeOf<CommandParamArgs<'<user:at> [other:at]'>>().toEqualTypeOf<
            [number, number | undefined]
        >()

        expectTypeOf<
            CommandParamArgs<'[name:string="hello world"]'>
        >().toEqualTypeOf<[string]>()

        expectTypeOf<CommandParamArgs<''>>().toEqualTypeOf<[]>()
        expectTypeOf<CommandParamArgs<string>>().toEqualTypeOf<any[]>()
    })

    it('rejects handlers with mismatched argument types', () => {
        // @ts-expect-error 声明为 integer，handler 不能标注为 string
        assertCmdArgs<[number]>((_e, _c, _m, n: string) => void n)
    })
})

function assertCmdArgs<TArgs extends unknown[]>(
    handler: CommandHandler<OneBotMessageEvent, TArgs>
): void {
    void handler
}
