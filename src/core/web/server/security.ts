import type { ServerResponse } from 'node:http'

export const SECURITY_HEADERS: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
}

export function applySecurityHeaders(res: ServerResponse): void {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(key, value)
    }
}
