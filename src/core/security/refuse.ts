import type { SnowLumaEvent, SnowLumaEventContext } from '@snowluma/sdk'
import type { Logger } from '../logging/logger.js'
import type { MessageSender } from '../messaging/sender.js'
import type { Permission } from './permission.js'

export class PermissionRefuser {
    constructor(
        private readonly sender: MessageSender,
        private readonly logger: Logger
    ) {}

    async send(
        event: SnowLumaEvent,
        context: SnowLumaEventContext,
        required: Permission,
        actual: Permission
    ): Promise<void> {
        try {
            await this.sender.send(
                event,
                context,
                `权限不足：需要 ${required}，当前 ${actual}`,
                { quote: false }
            )
        } catch (error) {
            this.logger.error('failed to send permission refusal', error)
        }
    }
}
