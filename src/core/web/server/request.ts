import type { IncomingMessage } from 'node:http'
import type { URLSearchParamsLike } from '../http.js'

export function parseSearch(req: IncomingMessage): URLSearchParamsLike {
    const index = (req.url ?? '').indexOf('?')
    const query = index >= 0 ? (req.url ?? '').slice(index + 1) : ''

    return new URLSearchParams(query)
}

export function segmentsOf(pathname: string): string[] {
    return pathname
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => {
            try {
                return decodeURIComponent(segment)
            } catch {
                return segment
            }
        })
}

export function pathnameOf(req: IncomingMessage): string {
    const url = req.url ?? '/'
    const index = url.indexOf('?')
    const raw = index >= 0 ? url.slice(0, index) : url

    if (raw.includes('%')) {
        try {
            return decodeURIComponent(raw)
        } catch {
            return raw
        }
    }

    return raw
}
