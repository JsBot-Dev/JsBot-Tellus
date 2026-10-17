import type {
    OneBotGroupMessageEvent,
    OneBotPrivateMessageEvent,
} from '@snowluma/sdk'

interface PrivateContexts {
    sessions: Record<number, OneBotPrivateMessageEvent[]>
}
interface GroupContext {
    sessions: Record<number, OneBotGroupMessageEvent[]>
}
interface LLMContext {
    private: PrivateContexts
    group: GroupContext
}

export type { PrivateContexts, GroupContext, LLMContext }
