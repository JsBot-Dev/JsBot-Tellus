import { HttpError } from './http.js'
import {
    handleStatus,
    handleCommands,
    handleLogsList,
    handleEventsList,
} from './routes/status.js'
import {
    handleSessionDelete,
    handleSessionGet,
    handleSessionList,
    handleSessionMessages,
    handleSessionPut,
    handleSessionSend,
} from './routes/sessions.js'
import {
    handleInstallerAction,
    handlePluginConfigPut,
    handlePluginsList,
} from './routes/plugins.js'
import {
    handleConfigGet,
    handleConfigPut,
    handleConfigValidate,
} from './routes/config.js'
import {
    handleKvDelete,
    handleKvList,
    handleKvPlugins,
    handleKvPut,
} from './routes/kv.js'
import { handleActions, handleRuntimeCommand } from './routes/actions.js'
import type { ApiContext } from './routes/shared.js'

export type { ApiContext } from './routes/shared.js'

export async function handleApiRoute(ctx: ApiContext): Promise<boolean> {
    const { method, pathname } = ctx

    if (method === 'GET' && pathname === '/api/status') {
        await handleStatus(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/commands') {
        await handleCommands(ctx)

        return true
    }

    if (
        method === 'POST' &&
        [
            '/api/runtime/restart',
            '/api/runtime/pause',
            '/api/runtime/resume',
        ].includes(pathname)
    ) {
        await handleRuntimeCommand(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/logs') {
        await handleLogsList(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/events') {
        await handleEventsList(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/sessions') {
        await handleSessionList(ctx)

        return true
    }

    if (
        ctx.segments[0] === 'api' &&
        ctx.segments[1] === 'sessions' &&
        ctx.segments[2] !== undefined
    ) {
        if (ctx.segments[3] === undefined) {
            if (method === 'GET') {
                await handleSessionGet(ctx)

                return true
            }

            if (method === 'PUT') {
                await handleSessionPut(ctx)

                return true
            }

            if (method === 'DELETE') {
                await handleSessionDelete(ctx)

                return true
            }
        } else if (method === 'POST') {
            if (ctx.segments[3] === 'messages') {
                await handleSessionMessages(ctx)

                return true
            }

            if (ctx.segments[3] === 'send') {
                await handleSessionSend(ctx)

                return true
            }

            throw new HttpError(404, `not found: ${pathname}`)
        }

        throw new HttpError(405, `method not allowed: ${method} ${pathname}`)
    }

    if (method === 'GET' && pathname === '/api/plugins') {
        await handlePluginsList(ctx)

        return true
    }

    if (
        method === 'PUT' &&
        ctx.segments[0] === 'api' &&
        ctx.segments[1] === 'plugins' &&
        ctx.segments[3] === 'config'
    ) {
        await handlePluginConfigPut(ctx)

        return true
    }

    if (
        method === 'POST' &&
        [
            '/api/plugins/install',
            '/api/plugins/update',
            '/api/plugins/remove',
        ].includes(pathname)
    ) {
        await handleInstallerAction(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/config') {
        await handleConfigGet(ctx)

        return true
    }

    if (method === 'POST' && pathname === '/api/config/validate') {
        await handleConfigValidate(ctx)

        return true
    }

    if (method === 'PUT' && pathname === '/api/config') {
        await handleConfigPut(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/kv/plugins') {
        await handleKvPlugins(ctx)

        return true
    }

    if (pathname === '/api/kv' || pathname === '/api/kv/plugins') {
        if (method === 'GET' && pathname === '/api/kv') {
            await handleKvList(ctx)

            return true
        }

        if (method === 'PUT' && pathname === '/api/kv') {
            await handleKvPut(ctx)

            return true
        }

        if (method === 'DELETE' && pathname === '/api/kv') {
            await handleKvDelete(ctx)

            return true
        }
    }

    if (method === 'POST' && pathname === '/api/actions') {
        await handleActions(ctx)

        return true
    }

    return false
}
