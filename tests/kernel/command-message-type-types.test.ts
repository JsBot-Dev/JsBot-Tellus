import type {
    OneBotGroupMessageEvent,
    OneBotMessageEvent,
    OneBotPrivateMessageEvent,
} from '@snowluma/sdk'
import { describe, expectTypeOf, it } from 'vitest'
import type {
    CommandEventOf,
    CommandRegistrar,
    MessageTypeFilter,
} from '../../src/core/plugin/types.js'

declare const commands: CommandRegistrar
declare const dynamicMessageType: MessageTypeFilter

function checkMessageTypeNarrowing(): void {
    commands.register(
        {
            name: 'group-only',
            messageType: 'group',
        },
        async (event, context) => {
            expectTypeOf(event).toEqualTypeOf<OneBotGroupMessageEvent>()
            expectTypeOf(context.event).toEqualTypeOf<OneBotGroupMessageEvent>()

            void event.group_id
        }
    )

    commands.register(
        {
            name: 'private-only',
            messageType: 'private',
        },
        async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotPrivateMessageEvent>()
        }
    )

    commands.register(
        {
            name: 'group-array',
            messageType: ['group'],
        },
        async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotGroupMessageEvent>()
        }
    )

    commands.register(
        {
            name: 'all-types',
            messageType: ['group', 'private'],
        },
        async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotMessageEvent>()
        }
    )

    commands.register(
        {
            name: 'unrestricted',
        },
        async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotMessageEvent>()
        }
    )

    commands.register(
        {
            name: 'dynamic',
            messageType: dynamicMessageType,
        },
        async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotMessageEvent>()
        }
    )

    commands.group(
        {
            name: 'narrow-group',
            messageType: 'group',
            handler: async (event) => {
                expectTypeOf(event).toEqualTypeOf<OneBotGroupMessageEvent>()
            },
        },
        (group) => {
            group.register({ name: 'inherited' }, async (event) => {
                expectTypeOf(event).toEqualTypeOf<OneBotGroupMessageEvent>()
            })

            group.group({ name: 'nested' }, (nested) => {
                nested.register({ name: 'leaf' }, async (event) => {
                    expectTypeOf(event).toEqualTypeOf<OneBotGroupMessageEvent>()
                })
            })

            group.register(
                { name: 'override', messageType: 'private' },
                async (event) => {
                    expectTypeOf(
                        event
                    ).toEqualTypeOf<OneBotPrivateMessageEvent>()
                }
            )

            group.register(
                {
                    name: 'override-all',
                    messageType: ['group', 'private'],
                },
                async (event) => {
                    expectTypeOf(event).toEqualTypeOf<OneBotMessageEvent>()
                }
            )
        }
    )

    commands.group({ name: 'broad-group' }, (group) => {
        group.register({ name: 'inherited' }, async (event) => {
            expectTypeOf(event).toEqualTypeOf<OneBotMessageEvent>()
        })
    })
}

void checkMessageTypeNarrowing

describe('command message type inference', () => {
    it('maps messageType filters to handler event types', () => {
        expectTypeOf<
            CommandEventOf<'group'>
        >().toEqualTypeOf<OneBotGroupMessageEvent>()
        expectTypeOf<
            CommandEventOf<'private'>
        >().toEqualTypeOf<OneBotPrivateMessageEvent>()
        expectTypeOf<
            CommandEventOf<['group']>
        >().toEqualTypeOf<OneBotGroupMessageEvent>()
        expectTypeOf<
            CommandEventOf<readonly ['private']>
        >().toEqualTypeOf<OneBotPrivateMessageEvent>()
        expectTypeOf<
            CommandEventOf<['group', 'private']>
        >().toEqualTypeOf<OneBotMessageEvent>()
        expectTypeOf<
            CommandEventOf<undefined>
        >().toEqualTypeOf<OneBotMessageEvent>()
        expectTypeOf<
            CommandEventOf<MessageTypeFilter>
        >().toEqualTypeOf<OneBotMessageEvent>()
    })
})
