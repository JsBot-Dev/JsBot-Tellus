import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureInstallDir } from '../../src/core/plugin/install-dir.js'
import { validateInstalledPackage } from '../../src/core/plugin/install-validate.js'

async function writePackage(
    directory: string,
    name: string,
    entry: string
): Promise<void> {
    const location = join(directory, 'node_modules', name)
    await mkdir(location, { recursive: true })
    await writeFile(
        join(location, 'package.json'),
        `${JSON.stringify(
            {
                name,
                version: '1.2.3',
                type: 'module',
                exports: './index.js',
            },
            null,
            4
        )}\n`,
        'utf8'
    )
    await writeFile(join(location, 'index.js'), entry, 'utf8')
}

describe('validateInstalledPackage', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-validate-'))
        await ensureInstallDir(directory)
    })

    afterEach(async () => {
        await rm(directory, {
            recursive: true,
            force: true,
        })
    })

    it('loads plugin definitions in a child process', async () => {
        await writePackage(
            directory,
            'demo-plugin',
            `export default {
    manifest: {
        id: 'demo',
        version: '1.2.3',
        dependencies: ['helper', 42],
        configSchema: {},
    },
    setup() {},
}
`
        )

        const result = await validateInstalledPackage(
            directory,
            'demo-plugin',
            { timeoutMs: 15_000 }
        )

        expect(result).toEqual([
            {
                id: 'demo',
                version: '1.2.3',
                dependencies: ['helper'],
            },
        ])
    })

    it('collects plugins from named and array exports', async () => {
        await writePackage(
            directory,
            'demo-plugin',
            `const first = {
    manifest: { id: 'first', version: '1.0.0', configSchema: {} },
    setup() {},
}
const second = {
    manifest: { id: 'second', version: '1.0.0', configSchema: {} },
    setup() {},
}
export const plugin = first
export const plugins = [second]
`
        )

        const result = await validateInstalledPackage(
            directory,
            'demo-plugin',
            { timeoutMs: 15_000 }
        )

        expect(result.map((item) => item.id)).toEqual(['first', 'second'])
    })

    it('rejects packages without a plugin export', async () => {
        await writePackage(directory, 'not-a-plugin', 'export const x = 1\n')

        await expect(
            validateInstalledPackage(directory, 'not-a-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('does not export a JsBot plugin')
    })

    it('rejects packages that fail to import', async () => {
        await writePackage(
            directory,
            'broken-plugin',
            'throw new Error("boom")\n'
        )

        await expect(
            validateInstalledPackage(directory, 'broken-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('boom')
    })

    it('rejects missing packages', async () => {
        await expect(
            validateInstalledPackage(directory, 'missing-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow()
    })
})
