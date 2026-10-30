import { afterAll, describe, expect, it } from 'vitest'
import { AuthManager } from '../../src/core/web/auth.js'
import type { WebUiConfig } from '../../src/core/config/schema.js'

function config(overrides: Partial<WebUiConfig> = {}): WebUiConfig {
    return {
        enabled: true,
        host: '127.0.0.1',
        port: 8787,
        username: 'admin',
        password: 'secret-password',
        sessionTtlHours: 12,
        trustProxy: false,
        ...overrides,
    }
}

afterAll(() => {})

describe('AuthManager', () => {
    it('rejects when webui is disabled', async () => {
        const auth = new AuthManager({
            getConfig: () => config({ enabled: false }),
        })

        const result = await auth.login('admin', 'secret-password', '1.2.3.4')

        expect(result.ok).toBe(false)
        expect(result.status).toBe(503)
        expect(result.session).toBeUndefined()
    })

    it('rejects missing credentials', async () => {
        const auth = new AuthManager({
            getConfig: () => config({ password: undefined }),
        })

        const result = await auth.login('admin', 'secret-password', '1.2.3.4')

        expect(result.ok).toBe(false)
        expect(result.status).toBe(503)
    })

    it('issues a session for valid credentials', async () => {
        const auth = new AuthManager({ getConfig: () => config() })

        const result = await auth.login('admin', 'secret-password', '1.2.3.4')

        expect(result.ok).toBe(true)
        expect(result.session?.username).toBe('admin')
        expect(result.session?.token.length).toBeGreaterThan(20)

        expect(auth.authenticate(result.session?.token)).toMatchObject({
            username: 'admin',
        })
    })

    it('increments token expiry by sessionTtlHours', async () => {
        const now = Date.now()
        const auth = new AuthManager({
            getConfig: () => config(),
            now: () => now,
        })

        const result = await auth.login('admin', 'secret-password', 'ip')

        expect(result.session?.expiresAt).toBe(now + 12 * 60 * 60 * 1000)
    })

    it('rejects wrong username and password', async () => {
        const auth = new AuthManager({ getConfig: () => config() })

        const badUsername = await auth.login('root', 'secret-password', 'ip')
        const badPassword = await auth.login('admin', 'nope', 'ip')

        expect(badUsername.status).toBe(401)
        expect(badPassword.status).toBe(401)
    })

    it('handles non-string input safely', async () => {
        const auth = new AuthManager({ getConfig: () => config() })

        const result = await auth.login({ evil: true }, ['array'], 'ip')

        expect(result.ok).toBe(false)
    })

    it('rate limits repeated failures per ip', async () => {
        const auth = new AuthManager({ getConfig: () => config() })
        let now = Date.now()
        const clock = () => now

        const clocked = new AuthManager({
            getConfig: () => config(),
            now: clock,
        })

        for (let index = 0; index < 5; index += 1) {
            await clocked.login('admin', 'wrong', '1.1.1.1')
        }

        const blocked = await clocked.login('admin', 'wrong', '1.1.1.1')

        expect(blocked.status).toBe(429)
        expect(blocked.retryAfterSeconds).toBeGreaterThan(0)

        now += 15 * 60 * 1000
        void auth

        const afterWindow = await clocked.login('admin', 'wrong', '1.1.1.1')

        expect(afterWindow.status).toBe(401)
    })

    it('expires sessions after ttl', () => {
        let now = 1_000_000
        const auth = new AuthManager({
            getConfig: () => config(),
            now: () => now,
        })

        void auth
        const clocked = new AuthManager({
            getConfig: () => config(),
            now: () => now,
        })

        return clocked
            .login('admin', 'secret-password', 'ip')
            .then((result) => {
                const token = result.session?.token ?? ''

                now += 13 * 60 * 60 * 1000

                expect(clocked.authenticate(token)).toBeNull()
            })
    })

    it('logout invalidates the session', async () => {
        const auth = new AuthManager({ getConfig: () => config() })
        const result = await auth.login('admin', 'secret-password', 'ip')

        auth.logout(result.session?.token)

        expect(auth.authenticate(result.session?.token)).toBeNull()
    })

    it('invalidateAll drops every session', async () => {
        const auth = new AuthManager({ getConfig: () => config() })
        const a = await auth.login('admin', 'secret-password', 'ip')

        auth.invalidateAll()

        expect(auth.authenticate(a.session?.token)).toBeNull()
    })
})
