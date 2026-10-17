import { isMessageEvent, matchCommand, type EventMiddleware } from "@snowluma/sdk";
import type { JsBot } from "../bot";
import { getRole, refuse } from "../../utils/auth";

function createPermissionMiddleware(bot: JsBot): EventMiddleware {
    return (event, ctx, next) => {
        if (!isMessageEvent(event)) return next();

        for (const [name, meta] of bot.registrations.commands) {
            const command = matchCommand(event, name, {
                prefixes: meta.prefixes
            });

            if (command) {
                event.permission = meta.permission;
                return next();
            }
        }

        event.permission = 'User';
        return next();
    };
}

function createAuthMiddleware(bot: JsBot): EventMiddleware {
    return async (event, ctx, next) => {
        if (!isMessageEvent(event)) return next();

        const role = getRole(bot.config, event.user_id);
        switch (event.permission) {
            case 'SuperAdmin':
                if (role === 'SuperAdmin') return next();
                break;
            case 'Admin':
                if (role === 'SuperAdmin' || role === 'Admin') return next();
                break;
            case 'User':
                return next();
        }

        await refuse(bot, ctx, event);
    };
}

export { createPermissionMiddleware, createAuthMiddleware };
