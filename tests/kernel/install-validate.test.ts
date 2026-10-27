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
        dependencies: ['helper'],
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
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
    manifest: { id: 'first', version: '1.0.0', configSchema: { safeParse: () => ({ success: true, data: {} }) } },
    setup() {},
}
const second = {
    manifest: { id: 'second', version: '1.0.0', configSchema: { safeParse: () => ({ success: true, data: {} }) } },
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

    it('skips malformed entries in plugin arrays', async () => {
        await writePackage(
            directory,
            'mixed-plugin',
            `const valid = {
    manifest: {
        id: 'valid',
        version: '1.0.0',
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
    },
    setup() {},
}
export const plugins = [
    valid,
    { nope: true },
    {
        manifest: { id: 'bad', version: '1.0.0', configSchema: {} },
        setup() {},
    },
]
`
        )

        const result = await validateInstalledPackage(
            directory,
            'mixed-plugin',
            { timeoutMs: 15_000 }
        )

        expect(result.map((item) => item.id)).toEqual(['valid'])
    })

    it('rejects plugins with invalid dependencies or config schemas', async () => {
        await writePackage(
            directory,
            'bad-shape',
            `export default {
    manifest: {
        id: 'bad-shape',
        version: '1.0.0',
        dependencies: ['ok', 42],
        configSchema: {},
    },
    setup() {},
}
`
        )

        await expect(
            validateInstalledPackage(directory, 'bad-shape', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('does not export a JsBot plugin')
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

    it('validates packages with require-only exports', async () => {
        const location = join(directory, 'node_modules', 'cjs-plugin')
        await mkdir(location, { recursive: true })
        await writeFile(
            join(location, 'package.json'),
            `${JSON.stringify(
                {
                    name: 'cjs-plugin',
                    version: '1.0.0',
                    exports: {
                        '.': {
                            require: './index.cjs',
                        },
                    },
                },
                null,
                4
            )}\n`,
            'utf8'
        )
        await writeFile(
            join(location, 'index.cjs'),
            `module.exports = {
    manifest: {
        id: 'cjs',
        version: '1.0.0',
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
    },
    setup() {},
}
`,
            'utf8'
        )

        const result = await validateInstalledPackage(directory, 'cjs-plugin', {
            timeoutMs: 15_000,
        })

        expect(result.map((item) => item.id)).toEqual(['cjs'])
    })

    it('rejects missing packages', async () => {
        await expect(
            validateInstalledPackage(directory, 'missing-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow()
    })
})
