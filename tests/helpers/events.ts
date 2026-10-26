import type {
    OneBotGroupMessageEvent,
    OneBotNoticeEvent,
    OneBotPrivateMessageEvent,
} from '@snowluma/sdk'

export function groupMessage(
    overrides: Partial<OneBotGroupMessageEvent> = {}
): OneBotGroupMessageEvent {
    return {
        time: 1,
        self_id: 10000,
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        message_id: 1,
        group_id: 123456,
        user_id: 10001,
        message: [],
        raw_message: 'hello',
        font: 0,
        sender: {
            user_id: 10001,
            nickname: 'User',
        },
        ...overrides,
    }
}

export function pokeNotice(
    overrides: Partial<OneBotNoticeEvent> & {
        target_id?: number
    } = {}
): OneBotNoticeEvent {
    return {
        time: 1,
        self_id: 10000,
        post_type: 'notice',
        notice_type: 'notify',
        sub_type: 'poke',
        group_id: 123456,
        user_id: 10001,
        target_id: 10000,
        ...overrides,
    }
}

export function privateMessage(
    overrides: Partial<OneBotPrivateMessageEvent> = {}
): OneBotPrivateMessageEvent {
    return {
        time: 1,
        self_id: 10000,
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 2,
        user_id: 20001,
        message: [],
        raw_message: 'hello',
        font: 0,
        sender: {
            user_id: 20001,
            nickname: 'User',
        },
        ...overrides,
    }
}
