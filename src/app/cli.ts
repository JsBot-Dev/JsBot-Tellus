import { parseArgs } from 'node:util'
import { LOCAL_PLUGIN_DIR } from './runtime.js'

export const USAGE = `Usage: jsbot [options]

Options:
  --config <path>      Config file path (env: BOT_CONFIG)
  --data-dir <path>    Data directory (env: BOT_DATA_DIR)
  --log-level <level>  debug, info, warn or error (env: BOT_LOG_LEVEL)
  --help               Show this help

Config precedence: CLI > environment > ./bot.config.json.
Data precedence: CLI > environment > ./data.
Local plugins: ./${LOCAL_PLUGIN_DIR}/<id>/dist (auto-built when missing).
`

export function pick(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined
}

export interface CliOptions {
    help: boolean
    config: string | undefined
    dataDir: string | undefined
    logLevel: string | undefined
}

export function parseCli(): CliOptions {
    const { values } = parseArgs({
        options: {
            config: { type: 'string' },
            'data-dir': { type: 'string' },
            'log-level': { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: false,
    })

    return {
        help: values.help === true,
        config: values.config,
        dataDir: values['data-dir'],
        logLevel: values['log-level'],
    }
}
