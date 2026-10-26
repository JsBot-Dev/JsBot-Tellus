import type { Logger } from '../logging/logger.js'

export interface TaskQueue {
    enqueue(key: string, task: (signal: AbortSignal) => Promise<void>): void
    drain(timeoutMs?: number): Promise<boolean>
    cancelAll(): void
}

export class PerKeyTaskQueue implements TaskQueue {
    private readonly chains = new Map<string, Promise<void>>()
    private readonly controllers = new Set<AbortController>()
    private stopped = false

    constructor(private readonly logger: Logger) {}

    enqueue(key: string, task: (signal: AbortSignal) => Promise<void>): void {
        if (this.stopped) return

        const controller = new AbortController()
        this.controllers.add(controller)

        const previous = this.chains.get(key) ?? Promise.resolve()

        const run = previous
            .catch(() => undefined)
            .then(async () => {
                if (controller.signal.aborted) return

                try {
                    await task(controller.signal)
                } catch (error) {
                    if (!controller.signal.aborted) {
                        this.logger.error(`task failed: ${key}`, error)
                    }
                } finally {
                    this.controllers.delete(controller)
                }
            })

        this.chains.set(key, run)

        void run.finally(() => {
            if (this.chains.get(key) === run) {
                this.chains.delete(key)
            }
        })
    }

    async drain(timeoutMs = 5_000): Promise<boolean> {
        const pending = [...this.chains.values()]

        if (pending.length === 0) return true

        if (timeoutMs <= 0) return false

        return await new Promise<boolean>((resolve) => {
            let settled = false

            const timer = setTimeout(() => {
                if (settled) return

                settled = true
                resolve(false)
            }, timeoutMs)

            const finish = (): void => {
                if (settled) return

                settled = true
                clearTimeout(timer)
                resolve(true)
            }

            void Promise.allSettled(pending).then(finish)
        })
    }

    cancelAll(): void {
        this.stopped = true

        for (const controller of this.controllers) {
            controller.abort()
        }

        this.controllers.clear()
    }
}
