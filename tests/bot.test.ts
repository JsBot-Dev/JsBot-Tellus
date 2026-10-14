import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ConfigSchema } from '../src/core/config/schema'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtures = path.join(root, 'tests/fixtures/scenario.mjs')
const temporaryDirectories: string[] = []

afterEach(() => {
    for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runScenario(name: string) {
    const tempRoot = existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir()
    const dir = mkdtempSync(path.join(tempRoot, 'jsbot-vitest-'))
    temporaryDirectories.push(dir)
    cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true })
    if (name === 'plugins-extra' || name === 'retry-extra') {
        const pluginDir = path.join(dir, 'src/plugins/plugin-extra')
        mkdirSync(pluginDir)
        writeFileSync(path.join(pluginDir, 'index.ts'), `
import { JsBotBasePlugin, Command } from '../../core/index.ts'
import { Middleware, OnNotice } from '../../core/decorator/decorator.ts'

export default class ExtraPlugin extends JsBotBasePlugin {
    @Command('extra.test')
    test = async () => {}

    @OnNotice('extra-test')
    notice = async () => {}

    @Middleware()
    middleware = (_event, _ctx, next) => next()
}
`)
    }
    if (name === 'constructor-kv' || name === 'constructor-retry') {
        const pluginDir = path.join(dir, 'src/plugins/plugin-kv-constructor')
        mkdirSync(pluginDir)
        writeFileSync(path.join(pluginDir, 'index.ts'), `
import { JsBotBasePlugin } from '../../core/plugin/base.ts'

export default class ConstructorKvPlugin extends JsBotBasePlugin {
    static attempts = 0
    initial: number
    constructor(bot: ConstructorParameters<typeof JsBotBasePlugin>[0]) {
        super(bot)
        this.initial = this.get_kv('counter') ?? 0
        this.set_kv('counter', this.initial + 1)
        if (${name === 'constructor-retry'} && ++ConstructorKvPlugin.attempts === 1) {
            throw new Error('constructor failed')
        }
    }
}
`)
    }
    cpSync(fixtures, path.join(dir, 'scenario.mjs'))
    cpSync(path.join(root, 'package.json'), path.join(dir, 'package.json'))
    symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
    writeFileSync(path.join(dir, 'bot.config.json'), JSON.stringify({
        url: 'ws://127.0.0.1:1/', accessToken: '0123456789abcdef',
        role: { superadmin: [1], admin: [2] }
    }))
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scenario.mjs', name], {
        cwd: dir, encoding: 'utf8', timeout: 30_000
    })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

describe('offline bot integration', () => {
    it('discovers all plugins and registers commands', () => runScenario('plugins'))
    it('accepts additional plugins, commands and handlers', () => runScenario('plugins-extra'))
    it('replies to commands with the required permissions', () => runScenario('commands'))
    it('only reacts to pokes directed at the bot', () => runScenario('poke'))
    it('retries connections without duplicate handlers and shares concurrent starts', () => runScenario('retry'))
    it('retries without duplicate middlewares when an extra plugin registers one', () => runScenario('retry-extra'))
    it('rolls back partially registered handlers', () => runScenario('rollback'))
    it('allows plugin constructors to read and write KV', () => runScenario('constructor-kv'))
    it('releases KV after a plugin constructor fails and retries', () => runScenario('constructor-retry'))
    it('stops idempotently, releases SQLite and rejects a restart', () => runScenario('stop'))
    it('closes cleanly during an in-flight connection', () => runScenario('stop-during-connect'))

    it('accepts the shipped example configuration', () => {
        const example = JSON.parse(readFileSync(path.join(root, 'bot.config.example.json'), 'utf8'))
        expect(ConfigSchema.safeParse(example).success).toBe(true)
        expect(ConfigSchema.safeParse({ ...example, accessToken: '' }).success).toBe(false)
    })
})
