import type { Logger, LogRecord } from '../../src/core/logging/logger.js'
import type { Database } from '../../src/core/storage/database.js'
import type { SnowLumaEvent } from '@snowluma/sdk'
import {
    appConfigSchema,
    type AppConfig,
    type RolesConfig,
} from '../../src/core/config/schema.js'
import { Kernel } from '../../src/core/kernel.js'
import type {
    AnyPluginDefinition,
    PluginInstaller,
} from '../../src/core/plugin/types.js'
import { openMemoryDatabase } from '../../src/core/storage/database.js'
import { FakeClient } from './fake-client.js'
import { FakeEventContext } from './event-context.js'
import { createCapturingLogger } from './loggers.js'

export interface TestAppOptions {
    plugins?: AnyPluginDefinition[] | undefined
    pluginConfigs?: Record<string, unknown> | undefined
    roles?: RolesConfig | undefined
    config?: AppConfig | undefined
    drainTimeoutMs?: number | undefined
    client?: FakeClient | undefined
    database?: Database | undefined
    logger?: Logger | undefined
    installer?: PluginInstaller | undefined
    onRestart?: (() => void) | undefined
}

export interface TestApp {
    client: FakeClient
    kernel: Kernel
    config: AppConfig
    database: Database
    logger: Logger
    records: LogRecord[]
    dispatch(event: SnowLumaEvent): Promise<FakeEventContext>
    drain(): Promise<boolean>
    stop(): Promise<void>
}

export async function createTestApp(
    options: TestAppOptions = {}
): Promise<TestApp> {
    const captured = createCapturingLogger('test')
    const logger = options.logger ?? captured.logger
    const config =
        options.config ??
        appConfigSchema.parse({
            ...(options.roles !== undefined ? { roles: options.roles } : {}),
            plugins: options.pluginConfigs ?? {},
        })
    const client = options.client ?? new FakeClient()
    const database = options.database ?? openMemoryDatabase()
    const kernel = new Kernel({
        config,
        client,
        database,
        logger,
        plugins: options.plugins ?? [],
        ...(options.installer !== undefined
            ? { installer: options.installer }
            : {}),
        ...(options.onRestart !== undefined
            ? { onRestart: options.onRestart }
            : {}),
        ...(options.drainTimeoutMs !== undefined
            ? { drainTimeoutMs: options.drainTimeoutMs }
            : {}),
    })

    await kernel.start()

    return {
        client,
        kernel,
        config,
        database,
        logger,
        records: captured.records,
        async dispatch(event) {
            const context = new FakeEventContext(event)
            await client.dispatch(event, context)
            return context
        },
        drain: () => kernel.drain(),
        stop: () => kernel.stop(),
    }
}
