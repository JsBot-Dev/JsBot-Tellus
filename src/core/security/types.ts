import type { PermissionType } from "../decorator/types";

declare module '@snowluma/sdk' {
    interface OneBotGroupMessageEvent {
        permission: PermissionType
    }

    interface OneBotPrivateMessageEvent {
        permission: PermissionType
    }
}
