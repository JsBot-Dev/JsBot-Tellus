import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generatePlugin } from '../../scripts/plugin-gen.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'jsbot-plugin-gen-'))

    temporaryDirectories.push(directory)

    return directory
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true }))
    )
})

describe('plugin generator', () => {
    it('generates a local plugin template', async () => {
        const root = await temporaryDirectory()
        const result = await generatePlugin({
            id: 'weather',
            description: 'Weather helper',
            root,
        })

        expect(result).toEqual({
            id: 'weather',
            directory: join(root, 'weather'),
            files: [
                'package.json',
                'tsconfig.json',
                'src/index.ts',
                'README.md',
            ],
        })

        const manifest = JSON.parse(
            await readFile(join(result.directory, 'package.json'), 'utf8')
        ) as Record<string, unknown>

        expect(manifest).toMatchObject({
            name: '@jsbot-tellus/plugin-weather',
            version: '0.1.0',
            private: true,
            description: 'Weather helper',
            type: 'module',
            main: './dist/index.js',
            scripts: {
                build: 'tsc -p tsconfig.json',
                check: 'tsc -p tsconfig.json --noEmit',
            },
            dependencies: {
                zod: '^4.6.7',
            },
        })
        expect(
            (manifest['devDependencies'] as Record<string, string>)[
                '@jsbot-tellus/core'
            ]
        ).toMatch(/^\^\d+\.\d+\.\d+/)

        const tsconfig = JSON.parse(
            await readFile(join(result.directory, 'tsconfig.json'), 'utf8')
        ) as Record<string, unknown>

        expect(tsconfig).toMatchObject({
            extends: '../../tsconfig.base.json',
            compilerOptions: {
                outDir: 'dist',
                rootDir: 'src',
            },
        })

        const source = await readFile(
            join(result.directory, 'src', 'index.ts'),
            'utf8'
        )

        expect(source).toContain("id: 'weather'")
        expect(source).toContain("name: 'weather'")
        expect(source).toContain("default('hello from weather')")

        const readme = await readFile(
            join(result.directory, 'README.md'),
            'utf8'
        )

        expect(readme).toContain('plugins/weather')
    })

    it('uses a custom package name', async () => {
        const root = await temporaryDirectory()
        const result = await generatePlugin({
            id: 'demo',
            name: '@example/plugin-demo',
            root,
        })

        const manifest = JSON.parse(
            await readFile(join(result.directory, 'package.json'), 'utf8')
        ) as Record<string, unknown>

        expect(manifest['name']).toBe('@example/plugin-demo')
    })

    it('rejects invalid plugin ids and package names', async () => {
        const root = await temporaryDirectory()

        await expect(generatePlugin({ id: '../escape', root })).rejects.toThrow(
            /插件 id/
        )
        await expect(
            generatePlugin({
                id: 'demo',
                name: 'not a package',
                root,
            })
        ).rejects.toThrow(/包名/)
    })

    it('refuses to overwrite an existing plugin directory', async () => {
        const root = await temporaryDirectory()

        await generatePlugin({ id: 'demo', root })
        await expect(generatePlugin({ id: 'demo', root })).rejects.toThrow(
            /已存在/
        )
    })
})
