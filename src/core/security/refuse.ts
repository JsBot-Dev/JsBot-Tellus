import type {
    SnowLumaEvent,
    SnowLumaEventContextWithQuote,
} from '@snowluma/sdk'
import type { Logger } from '../logging/logger.js'
import type { MessageSender } from '../messaging/sender.js'
import {
    DEFAULT_PERMISSION_DENIED_MESSAGE,
    type Permission,
} from './permission.js'

export function formatPermissionDeniedMessage(
    template: string,
    required: Permission,
    actual: Permission
): string {
    return template
        .replaceAll('{required}', required)
        .replaceAll('{actual}', actual)
}

export class PermissionRefuser {
    constructor(
        private readonly sender: MessageSender,
        private readonly logger: Logger,
        private readonly template: string = DEFAULT_PERMISSION_DENIED_MESSAGE
    ) {}

    async send(
        event: SnowLumaEvent,
        context: SnowLumaEventContextWithQuote,
        required: Permission,
        actual: Permission
    ): Promise<void> {
        try {
            await this.sender.send(
                event,
                context,
                formatPermissionDeniedMessage(this.template, required, actual),
                { quote: false }
            )
        } catch (error) {
            this.logger.error('failed to send permission refusal', error)
        }
    }
}
