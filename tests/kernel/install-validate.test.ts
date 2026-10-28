import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureInstallRoot } from '../../src/core/plugin/install-dir.js'
import { validateInstalledPackage } from '../../src/core/plugin/install-validate.js'

async function writePlugin(
    root: string,
    name: string,
    files: Record<string, string>
): Promise<string> {
    const directory = join(root, name)

    await mkdir(join(directory, 'dist'), { recursive: true })
    await writeFile(
        join(directory, 'package.json'),
        `${JSON.stringify(
            {
                name,
                version: '1.2.3',
                type: 'module',
            },
            null,
            4
        )}\n`,
        'utf8'
    )

    for (const [file, content] of Object.entries(files)) {
        const path = join(directory, 'dist', file)

        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf8')
    }

    return directory
}

function pluginEntry(id: string, dependencies = '[]'): string {
    return `export default {
    manifest: {
        id: '${id}',
        version: '1.2.3',
        dependencies: ${dependencies},
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
    },
    setup() {},
}
`
}

describe('validateInstalledPackage', () => {
    let root: string

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'jsbot-validate-'))
        await ensureInstallRoot(root)
    })

    afterEach(async () => {
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('loads plugin definitions in a child process', async () => {
        const directory = await writePlugin(root, 'demo-plugin', {
            'index.js': pluginEntry('demo', "['helper']"),
        })

        const result = await validateInstalledPackage(
            directory,
            'demo-plugin',
            {
                timeoutMs: 15_000,
            }
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
        const directory = await writePlugin(root, 'demo-plugin', {
            'index.js': `const first = {
    manifest: { id: 'first', version: '1.0.0', configSchema: { safeParse: () => ({ success: true, data: {} }) } },
    setup() {},
}
const second = {
    manifest: { id: 'second', version: '1.0.0', configSchema: { safeParse: () => ({ success: true, data: {} }) } },
    setup() {},
}
export const plugin = first
export const plugins = [second]
`,
        })

        const result = await validateInstalledPackage(
            directory,
            'demo-plugin',
            {
                timeoutMs: 15_000,
            }
        )

        expect(result.map((item) => item.id)).toEqual(['first', 'second'])
    })

    it('skips malformed entries in plugin arrays', async () => {
        const directory = await writePlugin(root, 'mixed-plugin', {
            'index.js': `const valid = {
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
`,
        })

        const result = await validateInstalledPackage(
            directory,
            'mixed-plugin',
            {
                timeoutMs: 15_000,
            }
        )

        expect(result.map((item) => item.id)).toEqual(['valid'])
    })

    it('ignores helper files without plugin exports', async () => {
        const directory = await writePlugin(root, 'helper-plugin', {
            'index.js': pluginEntry('helper-plugin'),
            'helper.js': 'export const value = 1\n',
        })

        const result = await validateInstalledPackage(
            directory,
            'helper-plugin',
            { timeoutMs: 15_000 }
        )

        expect(result.map((item) => item.id)).toEqual(['helper-plugin'])
    })

    it('rejects plugins with invalid dependencies or config schemas', async () => {
        const directory = await writePlugin(root, 'bad-shape', {
            'index.js': `export default {
    manifest: {
        id: 'bad-shape',
        version: '1.0.0',
        dependencies: ['ok', 42],
        configSchema: {},
    },
    setup() {},
}
`,
        })

        await expect(
            validateInstalledPackage(directory, 'bad-shape', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('does not export a JsBot plugin')
    })

    it('rejects packages without a plugin export', async () => {
        const directory = await writePlugin(root, 'not-a-plugin', {
            'index.js': 'export const x = 1\n',
        })

        await expect(
            validateInstalledPackage(directory, 'not-a-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('does not export a JsBot plugin')
    })

    it('rejects packages that fail to import', async () => {
        const directory = await writePlugin(root, 'broken-plugin', {
            'index.js': 'throw new Error("boom")\n',
        })

        await expect(
            validateInstalledPackage(directory, 'broken-plugin', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('boom')
    })

    it('validates packages with CommonJS exports', async () => {
        const directory = await writePlugin(root, 'cjs-plugin', {
            'index.cjs': `module.exports = {
    manifest: {
        id: 'cjs',
        version: '1.0.0',
        configSchema: { safeParse: () => ({ success: true, data: {} }) },
    },
    setup() {},
}
`,
        })

        const result = await validateInstalledPackage(directory, 'cjs-plugin', {
            timeoutMs: 15_000,
        })

        expect(result.map((item) => item.id)).toEqual(['cjs'])
    })

    it('rejects packages without a dist directory', async () => {
        const directory = join(root, 'missing-dist')

        await mkdir(directory, { recursive: true })
        await writeFile(
            join(directory, 'package.json'),
            '{"name":"missing-dist","version":"1.0.0"}\n',
            'utf8'
        )

        await expect(
            validateInstalledPackage(directory, 'missing-dist', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('缺少 dist 目录')
    })

    it('rejects an empty dist directory', async () => {
        const directory = join(root, 'empty-dist')

        await mkdir(join(directory, 'dist'), { recursive: true })

        await expect(
            validateInstalledPackage(directory, 'empty-dist', {
                timeoutMs: 15_000,
            })
        ).rejects.toThrow('没有可加载的文件')
    })
})
