import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, safeStringify } from '../http.js'

export const SSE_HEARTBEAT_MS = 15_000
export const DEFAULT_MAX_SSE_CLIENTS = 20
export const SSE_TIMEOUT_MS = 60_000

export interface SseConnection {
    res: ServerResponse
    close(): void
}

export interface OpenSseOptions {
    req: IncomingMessage
    res: ServerResponse
    subscribe: (listener: (entry: unknown) => void) => () => void
    openedAt: number
    maxClients: number
    connections: Set<SseConnection>
}

export function openSse(options: OpenSseOptions): void {
    const { req, res, subscribe, openedAt, maxClients, connections } = options

    if (connections.size >= maxClients) {
        throw new HttpError(503, '实时连接数量已达上限')
    }

    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
    })
    res.write(':ok\n\n')

    const connection: SseConnection = {
        res,
        close: () => {
            unsubscribe()
            clearInterval(heartbeat)
            connections.delete(connection)

            try {
                res.end()
            } catch {
                // Already closed.
            }
        },
    }

    let closing = false

    const unsubscribe = subscribe((entry) => {
        if (closing) return

        res.write(`data: ${safeStringify(entry)}\n\n`)
    })

    const heartbeat = setInterval(() => {
        res.write(`:keepalive ${Date.now() - openedAt}\n\n`)
    }, SSE_HEARTBEAT_MS)

    req.on('close', () => {
        if (closing) return

        closing = true

        unsubscribe()
        clearInterval(heartbeat)
        connections.delete(connection)
    })

    connections.add(connection)
}
