export type LifecycleState =
    'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export interface LifecycleHooks {
    onStart(): Promise<void>
    onStop(): Promise<void>
}

export class Lifecycle {
    private stateValue: LifecycleState = 'idle'
    private startPromise: Promise<void> | null = null
    private stopPromise: Promise<void> | null = null

    constructor(private readonly hooks: LifecycleHooks) {}

    get state(): LifecycleState {
        return this.stateValue
    }

    start(): Promise<void> {
        if (this.stateValue === 'running') {
            return Promise.resolve()
        }

        if (this.stateValue === 'starting') {
            if (this.startPromise) return this.startPromise

            return Promise.reject(
                new Error('lifecycle is starting without a promise')
            )
        }

        if (this.stateValue !== 'idle') {
            return Promise.reject(
                new Error(
                    `cannot start lifecycle from state ${this.stateValue}`
                )
            )
        }

        this.stateValue = 'starting'
        this.startPromise = this.runStart()

        return this.startPromise
    }

    stop(): Promise<void> {
        switch (this.stateValue) {
            case 'stopped':
                return Promise.resolve()

            case 'stopping':
                if (this.stopPromise) return this.stopPromise

                return Promise.reject(
                    new Error('lifecycle is stopping without a promise')
                )

            case 'starting':
                return this.stopAfterStart()

            case 'failed':
                this.stateValue = 'stopped'
                return Promise.resolve()

            case 'idle':
                this.stateValue = 'stopping'
                this.stopPromise = this.runStop()
                return this.stopPromise

            case 'running':
                return this.stopRunning()
        }
    }

    private async runStart(): Promise<void> {
        try {
            await this.hooks.onStart()
            this.stateValue = 'running'
        } catch (error) {
            this.stateValue = 'failed'
            throw error
        }
    }

    private async stopAfterStart(): Promise<void> {
        const startPromise = this.startPromise

        if (!startPromise) {
            this.stateValue = 'stopped'
            return
        }

        try {
            await startPromise
        } catch {}

        if (this.stateValue === 'running') {
            await this.stopRunning()
            return
        }

        this.stateValue = 'stopped'
    }

    private stopRunning(): Promise<void> {
        if (this.stateValue === 'stopping' && this.stopPromise) {
            return this.stopPromise
        }

        if (this.stateValue !== 'running') {
            this.stateValue = 'stopped'
            return Promise.resolve()
        }

        this.stateValue = 'stopping'
        this.stopPromise = this.runStop()

        return this.stopPromise
    }

    private async runStop(): Promise<void> {
        try {
            await this.hooks.onStop()
        } finally {
            this.stateValue = 'stopped'
        }
    }
}
