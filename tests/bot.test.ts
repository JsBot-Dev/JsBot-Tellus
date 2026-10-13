import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    it('replies to commands with the required permissions', () => runScenario('commands'))
    it('only reacts to pokes directed at the bot', () => runScenario('poke'))
    it('retries connections without duplicate handlers and shares concurrent starts', () => runScenario('retry'))
    it('rolls back partially registered handlers', () => runScenario('rollback'))
    it('stops idempotently, releases SQLite and rejects a restart', () => runScenario('stop'))
    it('closes cleanly during an in-flight connection', () => runScenario('stop-during-connect'))

    it('accepts the shipped example configuration', () => {
        const example = JSON.parse(readFileSync(path.join(root, 'bot.config.example.json'), 'utf8'))
        expect(ConfigSchema.safeParse(example).success).toBe(true)
        expect(ConfigSchema.safeParse({ ...example, accessToken: '' }).success).toBe(false)
    })
})
