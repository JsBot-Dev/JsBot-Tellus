import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { WebUiConfig } from '../config/schema.js'

const scryptAsync = promisify(scrypt)

export interface AuthSession {
    token: string
    username: string
    expiresAt: number
}

export interface AuthLoginResult {
    ok: boolean
    status: number
    message?: string
    session?: AuthSession
    retryAfterSeconds?: number
}

export interface AuthManagerOptions {
    getConfig(): WebUiConfig
    now?: (() => number) | undefined
    /** Failures allowed per IP inside the window. Defaults to 5. */
    maxFailures?: number | undefined
    /** Failure window. Defaults to 15 minutes. */
    windowMs?: number | undefined
}

interface FailureEntry {
    count: number
    resetAt: number
}

interface PasswordHash {
    salt: Buffer
    hash: Buffer
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
    return (await scryptAsync(password, salt, 64)) as Buffer
}

export class AuthManager {
    private readonly sessions = new Map<string, AuthSession>()
    private readonly failures = new Map<string, FailureEntry>()
    private cachedHash: (PasswordHash & { password: string }) | null = null

    constructor(private readonly options: AuthManagerOptions) {}

    async login(
        username: unknown,
        password: unknown,
        ip: string
    ): Promise<AuthLoginResult> {
        const now = this.now()
        const config = this.options.getConfig()

        if (!config.enabled) {
            return {
                ok: false,
                status: 503,
                message: 'webui 已禁用，无法登录',
            }
        }

        if (!this.hasCredentials(config)) {
            return {
                ok: false,
                status: 503,
                message: 'webui 账号密码未配置',
            }
        }

        const blocked = this.blockedRetryAfter(ip, now)

        if (blocked !== null) {
            return {
                ok: false,
                status: 429,
                message: '登录尝试过于频繁，请稍后再试',
                retryAfterSeconds: blocked,
            }
        }

        this.cleanup(now)

        const providedUsername = typeof username === 'string' ? username : ''
        const providedPassword = typeof password === 'string' ? password : ''

        const usernameMatches = providedUsername === config.username
        const passwordMatches = await this.comparePassword(
            config.password ?? '',
            providedPassword
        )

        if (!usernameMatches || !passwordMatches) {
            this.recordFailure(ip, now)

            return {
                ok: false,
                status: 401,
                message: '用户名或密码错误',
            }
        }

        this.failures.delete(ip)

        const token = randomBytes(32).toString('base64url')
        const expiresAt = now + (config.sessionTtlHours ?? 12) * 60 * 60 * 1000
        const session: AuthSession = {
            token,
            username: config.username ?? '',
            expiresAt,
        }

        this.sessions.set(token, session)

        return {
            ok: true,
            status: 200,
            session,
        }
    }

    authenticate(token: string | undefined): AuthSession | null {
        if (!token) return null

        const session = this.sessions.get(token)

        if (!session) return null

        if (session.expiresAt <= this.now()) {
            this.sessions.delete(token)

            return null
        }

        return session
    }

    logout(token: string | undefined): void {
        if (token) this.sessions.delete(token)
    }

    invalidateAll(): void {
        this.sessions.clear()
    }

    clearExpired(): void {
        this.cleanup(this.now())
    }

    private now(): number {
        return (this.options.now ?? Date.now)()
    }

    private hasCredentials(config: WebUiConfig): boolean {
        return (
            typeof config.username === 'string' &&
            config.username.length > 0 &&
            typeof config.password === 'string' &&
            config.password.length > 0
        )
    }

    private async comparePassword(
        expected: string,
        provided: string
    ): Promise<boolean> {
        const { salt, hash } = await this.hashFor(expected)
        const providedHash = await hashPassword(provided, salt)

        return timingSafeEqual(hash, providedHash)
    }

    private async hashFor(password: string): Promise<PasswordHash> {
        const cached = this.cachedHash

        if (cached && cached.password === password) return cached

        const salt = randomBytes(16)
        const hash = await hashPassword(password, salt)

        this.cachedHash = { password, salt, hash }

        return { salt, hash }
    }

    private maxFailures(): number {
        return this.options.maxFailures ?? 5
    }

    private windowMs(): number {
        return this.options.windowMs ?? 15 * 60 * 1000
    }

    private blockedRetryAfter(ip: string, now: number): number | null {
        const entry = this.failures.get(ip)

        if (!entry) return null

        if (entry.resetAt <= now) {
            this.failures.delete(ip)

            return null
        }

        if (entry.count < this.maxFailures()) return null

        return Math.max(Math.ceil((entry.resetAt - now) / 1000), 1)
    }

    private recordFailure(ip: string, now: number): void {
        const windowMs = this.windowMs()
        const entry = this.failures.get(ip)

        if (!entry || entry.resetAt <= now) {
            this.failures.set(ip, { count: 1, resetAt: now + windowMs })

            return
        }

        this.failures.set(ip, {
            count: entry.count + 1,
            resetAt: entry.resetAt,
        })

        if (this.failures.size > 1_000) {
            for (const [key, value] of this.failures) {
                if (value.resetAt <= now) this.failures.delete(key)
            }
        }
    }

    private cleanup(now: number): void {
        for (const [token, session] of this.sessions) {
            if (session.expiresAt <= now) this.sessions.delete(token)
        }

        for (const [ip, entry] of this.failures) {
            if (entry.resetAt <= now) this.failures.delete(ip)
        }
    }
}
