import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    pluginConfigFilePath,
    readPluginConfig,
    readPluginConfigs,
    resolvePluginConfigDir,
    restorePluginConfig,
    writePluginConfig,
} from '../../src/core/config/plugin-config.js'

describe('plugin config files', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-plugin-config-'))
    })

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true })
    })

    it('resolves the config directory under the data dir', () => {
        expect(resolvePluginConfigDir(directory)).toBe(
            join(directory, 'config', 'plugin')
        )
    })

    it('encodes plugin ids in file names', () => {
        expect(
            pluginConfigFilePath(
                join(directory, 'config', 'plugin'),
                '@scope/plugin name'
            )
        ).toBe(
            join(
                directory,
                'config',
                'plugin',
                '%40scope%2Fplugin%20name.jsonc'
            )
        )
    })

    it('reads a missing file as empty', async () => {
        const configDir = resolvePluginConfigDir(directory)
        const document = await readPluginConfig(configDir, 'demo')

        expect(document).toEqual({
            id: 'demo',
            path: join(configDir, 'demo.jsonc'),
            raw: null,
            hash: null,
            config: {},
            error: null,
            missing: true,
        })
    })

    it('treats a blank file as missing', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(join(configDir, 'demo.jsonc'), '  \n', 'utf8')

        const document = await readPluginConfig(configDir, 'demo')

        expect(document.missing).toBe(true)
        expect(document.config).toEqual({})
        expect(document.error).toBeNull()
    })

    it('treats a comment-only file as missing', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(
            join(configDir, 'demo.jsonc'),
            '// TODO: configure this plugin\n',
            'utf8'
        )

        const document = await readPluginConfig(configDir, 'demo')

        expect(document.missing).toBe(true)
        expect(document.config).toEqual({})
        expect(document.error).toBeNull()
    })

    it('reports non-object documents', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(join(configDir, 'demo.jsonc'), '[]', 'utf8')

        const document = await readPluginConfig(configDir, 'demo')

        expect(document.error).toContain('must be a JSON object')
        expect(document.config).toEqual({})
    })

    it('reports invalid envelopes', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(
            join(configDir, 'demo.jsonc'),
            JSON.stringify({ groups: { allow: [1], deny: [2] } }),
            'utf8'
        )

        const document = await readPluginConfig(configDir, 'demo')

        expect(document.error).toContain('invalid plugin config')
        expect(document.error).toContain('groups')
    })

    it('scans only visible jsonc files and decodes ids', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(join(configDir, 'demo.jsonc'), '{}', 'utf8')
        await writeFile(
            join(configDir, '%40scope%2Fplugin.jsonc'),
            '{}',
            'utf8'
        )
        await writeFile(join(configDir, 'demo.jsonc.bak'), '{}', 'utf8')
        await writeFile(join(configDir, '.hidden.jsonc'), '{}', 'utf8')
        await writeFile(join(configDir, 'demo.json'), '{}', 'utf8')
        await mkdir(join(configDir, 'nested.jsonc'))

        const documents = await readPluginConfigs(configDir)

        expect(documents.map((document) => document.id)).toEqual([
            '@scope/plugin',
            'demo',
        ])
    })

    it('returns an empty list when the directory does not exist', async () => {
        expect(
            await readPluginConfigs(resolvePluginConfigDir(directory))
        ).toEqual([])
    })

    it('writes canonical JSON and creates the directory', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await writePluginConfig(configDir, 'demo', {
            enabled: true,
            token: 'secret',
        })

        const raw = await readFile(join(configDir, 'demo.jsonc'), 'utf8')

        expect(JSON.parse(raw)).toEqual({
            enabled: true,
            token: 'secret',
        })
        expect(raw.endsWith('\n')).toBe(true)
        expect(await readdir(configDir)).toEqual(['demo.jsonc'])
    })

    it('restores raw content or deletes a missing original', async () => {
        const configDir = resolvePluginConfigDir(directory)

        await mkdir(configDir, { recursive: true })
        await writeFile(join(configDir, 'demo.jsonc'), '{"a":1}\n', 'utf8')

        await restorePluginConfig(configDir, 'demo', '// original\n{}\n')

        expect(await readFile(join(configDir, 'demo.jsonc'), 'utf8')).toBe(
            '// original\n{}\n'
        )

        await restorePluginConfig(configDir, 'demo', null)

        expect(await readdir(configDir)).toEqual([])
    })
})
