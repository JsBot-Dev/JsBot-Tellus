import type {
    OneBotNoticeEvent,
    OneBotRequestEvent,
    SnowLumaEvent,
    SnowLumaEventContextWithQuote,
} from '@snowluma/sdk'
import type {
    CommandMatch,
    EventContext,
    EventType,
    MessageHandler,
    NoticeHandler,
    RequestHandler,
} from '../plugin/types.js'
import type { MessageSender } from '../messaging/sender.js'

export interface MessageRegistration {
    pluginId: string
    handler: MessageHandler
}

export interface NoticeRegistration {
    pluginId: string
    noticeType?: string | undefined
    subType?: string | undefined
    handler: NoticeHandler
}

export interface RequestRegistration {
    pluginId: string
    requestType?: string | undefined
    handler: RequestHandler
}

export function eventTypeOf(event: SnowLumaEvent): EventType | null {
    switch (event.post_type) {
        case 'message':
        case 'message_sent':
            return 'message'
        case 'notice':
            return 'notice'
        case 'request':
            return 'request'
        case 'meta_event':
            return 'meta'
        default:
            return null
    }
}

export function sessionIdOf(event: SnowLumaEvent): string {
    if (event.post_type === 'message') {
        return event.message_type === 'group'
            ? `group:${event.group_id}`
            : `private:${event.user_id}`
    }

    const withGroup = event as {
        group_id?: unknown
        user_id?: unknown
        self_id?: unknown
    }

    if (typeof withGroup.group_id === 'number') {
        return `group:${withGroup.group_id}`
    }

    if (typeof withGroup.user_id === 'number') {
        return `private:${withGroup.user_id}`
    }

    return `meta:${typeof withGroup.self_id === 'number' ? withGroup.self_id : 0}`
}

export function createEventContext<TEvent extends SnowLumaEvent>(
    event: TEvent,
    sdkContext: SnowLumaEventContextWithQuote,
    sender: MessageSender,
    command: CommandMatch | null = null
): EventContext<TEvent> {
    return {
        event,
        sessionId: sessionIdOf(event),
        command,
        get stopped() {
            return sdkContext.stopped
        },
        send: (message, options) =>
            sender.send(event, sdkContext, message, options),
        stopPropagation: () => sdkContext.stopPropagation(),
    }
}

export class HandlerRegistry {
    private messageRegistrations: MessageRegistration[] = []
    private noticeRegistrations: NoticeRegistration[] = []
    private requestRegistrations: RequestRegistration[] = []

    registerMessage(pluginId: string, handler: MessageHandler): () => void {
        const registration: MessageRegistration = {
            pluginId,
            handler,
        }

        this.messageRegistrations.push(registration)

        return () => {
            this.messageRegistrations = this.messageRegistrations.filter(
                (item) => item !== registration
            )
        }
    }

    registerNotice(registration: NoticeRegistration): () => void {
        this.noticeRegistrations.push(registration)

        return () => {
            this.noticeRegistrations = this.noticeRegistrations.filter(
                (item) => item !== registration
            )
        }
    }

    registerRequest(registration: RequestRegistration): () => void {
        this.requestRegistrations.push(registration)

        return () => {
            this.requestRegistrations = this.requestRegistrations.filter(
                (item) => item !== registration
            )
        }
    }

    messages(): MessageRegistration[] {
        return this.messageRegistrations
    }

    notices(): NoticeRegistration[] {
        return this.noticeRegistrations
    }

    requests(): RequestRegistration[] {
        return this.requestRegistrations
    }

    removePlugin(pluginId: string): void {
        this.messageRegistrations = this.messageRegistrations.filter(
            (item) => item.pluginId !== pluginId
        )
        this.noticeRegistrations = this.noticeRegistrations.filter(
            (item) => item.pluginId !== pluginId
        )
        this.requestRegistrations = this.requestRegistrations.filter(
            (item) => item.pluginId !== pluginId
        )
    }
}

export function isNoticeOf(
    event: OneBotNoticeEvent,
    registration: NoticeRegistration
): boolean {
    if (
        registration.noticeType &&
        registration.noticeType !== event.notice_type
    ) {
        return false
    }

    if (registration.subType) {
        const subType = (event as { sub_type?: unknown }).sub_type

        if (subType !== registration.subType) return false
    }

    return true
}

export function isRequestOf(
    event: OneBotRequestEvent,
    registration: RequestRegistration
): boolean {
    return (
        !registration.requestType ||
        registration.requestType === event.request_type
    )
}
