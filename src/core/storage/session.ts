import type { Database } from './database.js'

export type SessionRole = 'system' | 'user' | 'assistant'

export interface SessionMessage {
    role: SessionRole
    content: string
    at: number
}

export interface SessionState {
    sessionId: string
    provider?: string | undefined
    model?: string | undefined
    persona?: string | undefined
    messages: SessionMessage[]
    updatedAt: number
}

export interface SessionStore {
    get(sessionId: string): Promise<SessionState | null>
    save(state: SessionState): Promise<void>
    history(sessionId: string, limit?: number): Promise<SessionMessage[]>
    append(sessionId: string, message: SessionMessage): Promise<void>
    replace(sessionId: string, messages: SessionMessage[]): Promise<void>
    clear(sessionId: string): Promise<void>
}

interface SessionRow {
    session_id: string
    provider: string | null
    model: string | null
    persona: string | null
    messages: string
    updated_at: number
}

function isSessionRole(value: unknown): value is SessionRole {
    return value === 'system' || value === 'user' || value === 'assistant'
}

function parseMessages(sessionId: string, raw: string): SessionMessage[] {
    const value: unknown = JSON.parse(raw)

    if (!Array.isArray(value)) {
        throw new Error(`invalid session messages: ${sessionId}`)
    }

    return value.map((item, index) => {
        if (
            typeof item !== 'object' ||
            item === null ||
            !('role' in item) ||
            !('content' in item) ||
            !('at' in item) ||
            !isSessionRole(item.role) ||
            typeof item.content !== 'string' ||
            typeof item.at !== 'number'
        ) {
            throw new Error(`invalid session message ${sessionId}:${index}`)
        }

        return {
            role: item.role,
            content: item.content,
            at: item.at,
        }
    })
}

function toState(row: SessionRow): SessionState {
    return {
        sessionId: row.session_id,
        ...(row.provider !== null ? { provider: row.provider } : {}),
        ...(row.model !== null ? { model: row.model } : {}),
        ...(row.persona !== null ? { persona: row.persona } : {}),
        messages: parseMessages(row.session_id, row.messages),
        updatedAt: row.updated_at,
    }
}

export class SqliteSessionStore implements SessionStore {
    constructor(private readonly database: Database) {}

    async get(sessionId: string): Promise<SessionState | null> {
        const row = this.database.connection
            .prepare(
                'SELECT session_id, provider, model, persona, messages, updated_at FROM sessions WHERE session_id = ?'
            )
            .get(sessionId) as SessionRow | undefined

        return row ? toState(row) : null
    }

    async save(state: SessionState): Promise<void> {
        this.database.connection
            .prepare(
                `INSERT INTO sessions (session_id, provider, model, persona, messages, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(session_id) DO UPDATE SET
                     provider = excluded.provider,
                     model = excluded.model,
                     persona = excluded.persona,
                     messages = excluded.messages,
                     updated_at = excluded.updated_at`
            )
            .run(
                state.sessionId,
                state.provider ?? null,
                state.model ?? null,
                state.persona ?? null,
                JSON.stringify(state.messages),
                state.updatedAt
            )
    }

    async history(
        sessionId: string,
        limit?: number
    ): Promise<SessionMessage[]> {
        const state = await this.get(sessionId)

        if (!state) return []

        if (limit === undefined || limit < 0) {
            return state.messages
        }

        if (limit === 0) return []

        return state.messages.slice(-limit)
    }

    async append(sessionId: string, message: SessionMessage): Promise<void> {
        const state = await this.get(sessionId)

        if (!state) {
            await this.save({
                sessionId,
                messages: [message],
                updatedAt: message.at,
            })
            return
        }

        await this.save({
            ...state,
            messages: [...state.messages, message],
            updatedAt: message.at,
        })
    }

    async replace(
        sessionId: string,
        messages: SessionMessage[]
    ): Promise<void> {
        const state = await this.get(sessionId)

        if (!state) {
            await this.save({
                sessionId,
                messages,
                updatedAt: Date.now(),
            })
            return
        }

        await this.save({
            ...state,
            messages,
            updatedAt: Date.now(),
        })
    }

    async clear(sessionId: string): Promise<void> {
        this.database.connection
            .prepare('DELETE FROM sessions WHERE session_id = ?')
            .run(sessionId)
    }
}
