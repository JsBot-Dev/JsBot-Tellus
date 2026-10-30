import { ElMessage } from 'element-plus'

export class ApiError extends Error {
    readonly status: number
    readonly details: unknown

    constructor(status: number, message: string, details?: unknown) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.details = details
    }
}

type Body = Record<string, unknown> | undefined

async function request<T>(
    method: string,
    url: string,
    body?: Body
): Promise<T> {
    const headers: Record<string, string> = {}

    if (body !== undefined) headers['content-type'] = 'application/json'
    if (method !== 'GET') headers['x-requested-with'] = 'jsbot-webui'

    const response = await fetch(url, {
        method,
        headers,
        credentials: 'same-origin',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    let payload: {
        data?: unknown
        error?: { message?: string; details?: unknown }
    } = {}

    try {
        payload = (await response.json()) as typeof payload
    } catch {
        // Non-JSON response body.
    }

    if (!response.ok) {
        const message = payload.error?.message ?? `HTTP ${response.status}`

        throw new ApiError(response.status, message, payload.error?.details)
    }

    return payload.data as T
}

export function apiGet<T>(url: string): Promise<T> {
    return request<T>('GET', url)
}

export function apiPost<T>(url: string, body?: Body): Promise<T> {
    return request<T>('POST', url, body)
}

export function apiPut<T>(url: string, body?: Body): Promise<T> {
    return request<T>('PUT', url, body)
}

export function apiDelete<T>(url: string, body?: Body): Promise<T> {
    return request<T>('DELETE', url, body)
}

export function errorMessage(error: unknown): string {
    if (error instanceof ApiError) return error.message
    if (error instanceof Error) return error.message

    return String(error)
}

export function showError(error: unknown): void {
    ElMessage.error(errorMessage(error))
}

export interface AuthMe {
    username: string
    expiresAt: number
}

export interface RuntimeStatus {
    generation: number
    state: string
    uptimeMs: number
    connected: boolean
    login: { userId: number; nickname: string } | null
    counts: {
        plugins: number
        loadedPlugins: number
        enabledPlugins: number
        sessions: number
        kvPlugins: number
    }
}

export interface Status {
    restarting: boolean
    startupError: string | null
    runtime: RuntimeStatus | null
    webui: {
        listening: { host: string; port: number } | null
        requiresProcessRestart: boolean
    }
    version: string
    paths: { config: string; data: string; plugins: string }
}

export interface CommandInfo {
    id: string
    pluginId: string
    description: string
}

export const fetchStatus = (): Promise<Status> => apiGet<Status>('/api/status')

export const fetchCommands = (): Promise<CommandInfo[]> =>
    apiGet<CommandInfo[]>('/api/commands')

export interface FeedEventItem {
    id: number
    time: number
    type: string
    summary: string
    event: unknown
}

export interface LogEntryItem {
    time: number
    level: string
    scope: string
    message: string
    args: string[]
}

export function formatTime(value: number): string {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function formatUptime(ms: number): string {
    if (ms <= 0) return '-'

    const seconds = Math.floor(ms / 1000)
    const days = Math.floor(seconds / 86_400)
    const hours = Math.floor((seconds % 86_400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const rest = seconds % 60

    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${rest}s`

    return `${rest}s`
}

export function connectSse(
    path: string,
    onData: (data: unknown) => void
): () => void {
    const source = new EventSource(path, { withCredentials: true })

    source.onmessage = (message): void => {
        try {
            onData(JSON.parse(message.data) as unknown)
        } catch {
            // Ignore malformed SSE payloads.
        }
    }

    return () => {
        source.close()
    }
}
