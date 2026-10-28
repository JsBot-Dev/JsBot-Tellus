#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const PLUGIN_ROOT = 'plugins'
const PLUGIN_VERSION = '0.1.0'
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const PACKAGE_NAME_PATTERN =
    /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i

interface RootManifest {
    version?: string | undefined
    dependencies?: Record<string, string> | undefined
    devDependencies?: Record<string, string> | undefined
}

export interface GeneratePluginOptions {
    id: string
    name?: string | undefined
    description?: string | undefined
    root?: string | undefined
}

export interface GeneratedPlugin {
    id: string
    directory: string
    files: string[]
}

function singleQuoted(value: string): string {
    return `'${value
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('\r', '\\r')
        .replaceAll('\n', '\\n')}'`
}

function validateId(value: string): string {
    const id = value.trim()

    if (!ID_PATTERN.test(id)) {
        throw new Error(
            '插件 id 只能包含小写字母、数字、点、下划线和连字符，且必须以字母或数字开头'
        )
    }

    return id
}

function validatePackageName(value: string): string {
    if (!PACKAGE_NAME_PATTERN.test(value)) {
        throw new Error(`非法的 npm 包名: ${value}`)
    }

    return value
}

async function readRootManifest(): Promise<RootManifest> {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const value: unknown = JSON.parse(
        await readFile(join(root, 'package.json'), 'utf8')
    )

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('无法读取根目录 package.json')
    }

    return value as RootManifest
}

function dependencyVersion(
    manifest: RootManifest,
    name: string,
    fallback: string
): string {
    const value =
        manifest.devDependencies?.[name] ?? manifest.dependencies?.[name]

    return typeof value === 'string' ? value : fallback
}

function templateSource(
    id: string,
    description: string,
    reply: string
): string {
    return `import { definePlugin } from '@jsbot-tellus/core'
import { z } from 'zod'

export default definePlugin({
    manifest: {
        id: ${singleQuoted(id)},
        version: ${singleQuoted(PLUGIN_VERSION)},
        description: ${singleQuoted(description)},
        defaultEnabled: true,
        configSchema: z
            .object({
                reply: z.string().min(1).default(${singleQuoted(reply)}),
            })
            .strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: ${singleQuoted(id)},
                permission: 'User',
                description: ${singleQuoted(description)},
            },
            async (_event, context) => {
                await context.send(ctx.config.reply)
            }
        )
    },
})
`
}

function templateReadme(
    id: string,
    packageName: string,
    description: string,
    reply: string
): string {
    return `# ${id}

${description}

## 开发

\`\`\`bash
npm install --prefix ${PLUGIN_ROOT}/${id}
npm run build --prefix ${PLUGIN_ROOT}/${id}
\`\`\`

启动根项目后，应用会自动从 \`${PLUGIN_ROOT}/${id}/dist\` 加载本插件。

## 配置

\`\`\`json
{
    "plugins": {
        "${id}": {
            "enabled": true,
            "reply": "${reply}"
        }
    }
}
\`\`\`

## 发布到 npm

准备发布时，删除 \`private\`，把包名 \`${packageName}\` 改成自己的作用域，并确认 \`dist/\` 已包含在发布文件中。不要把 \`@jsbot-tellus/core\` 写进 \`dependencies\` 或 \`peerDependencies\`。
`
}

async function installDependencies(directory: string): Promise<void> {
    console.log(`\n安装依赖: ${directory}`)

    await new Promise<void>((resolve, reject) => {
        const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
            cwd: directory,
            stdio: 'inherit',
            env: {
                ...process.env,
                npm_config_update_notifier: 'false',
            },
            shell: process.platform === 'win32',
        })

        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolve()
                return
            }

            reject(
                new Error(
                    signal !== null
                        ? `npm install 被信号 ${signal} 终止`
                        : `npm install 失败，退出码 ${code ?? 'unknown'}`
                )
            )
        })
    })
}

export async function generatePlugin(
    options: GeneratePluginOptions
): Promise<GeneratedPlugin> {
    const id = validateId(options.id)
    const packageName = validatePackageName(
        options.name?.trim() || `@jsbot-tellus/plugin-${id}`
    )
    const description = options.description?.trim() || `${id} plugin`
    const reply = `hello from ${id}`
    const root = resolve(options.root ?? PLUGIN_ROOT)
    const directory = join(root, id)
    const manifest = await readRootManifest()
    const coreVersion = `^${manifest.version ?? '0.0.0'}`
    const packageJson = {
        name: packageName,
        version: PLUGIN_VERSION,
        private: true,
        description,
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        },
        files: ['dist'],
        scripts: {
            build: 'tsc -p tsconfig.json',
            check: 'tsc -p tsconfig.json --noEmit',
            watch: 'tsc -p tsconfig.json --watch',
        },
        devDependencies: {
            '@jsbot-tellus/core': coreVersion,
            '@types/node': dependencyVersion(
                manifest,
                '@types/node',
                '^24.6.4'
            ),
            typescript: dependencyVersion(manifest, 'typescript', '^7.0.2'),
        },
        dependencies: {
            zod: dependencyVersion(manifest, 'zod', '^4.6.7'),
        },
    }
    const tsconfig = {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
            noEmit: false,
            outDir: 'dist',
            rootDir: 'src',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
        },
        include: ['src'],
    }

    await mkdir(root, { recursive: true })

    try {
        await mkdir(directory)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`插件目录已存在，请先移除: ${directory}`)
        }

        throw error
    }

    try {
        await mkdir(join(directory, 'src'), { recursive: true })
        await writeFile(
            join(directory, 'package.json'),
            `${JSON.stringify(packageJson, null, 4)}\n`,
            'utf8'
        )
        await writeFile(
            join(directory, 'tsconfig.json'),
            `${JSON.stringify(tsconfig, null, 4)}\n`,
            'utf8'
        )
        await writeFile(
            join(directory, 'src', 'index.ts'),
            templateSource(id, description, reply),
            'utf8'
        )
        await writeFile(
            join(directory, 'README.md'),
            templateReadme(id, packageName, description, reply),
            'utf8'
        )
    } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(
            () => undefined
        )
        throw error
    }

    return {
        id,
        directory,
        files: ['package.json', 'tsconfig.json', 'src/index.ts', 'README.md'],
    }
}

function usage(): string {
    return `Usage: npm run plugin:gen -- <plugin-id> [options]

Options:
  --name <name>          npm package name (default: @jsbot-tellus/plugin-<id>)
  --description <text>   plugin description
  --no-install           skip npm install
  -h, --help             show this help

Without a plugin id, an interactive prompt is shown when stdin is a TTY.`
}

async function promptId(): Promise<string> {
    if (!stdin.isTTY) {
        throw new Error('请提供插件 id：npm run plugin:gen -- <plugin-id>')
    }

    const readline = createInterface({ input: stdin, output: stdout })

    try {
        return await readline.question('插件 id: ')
    } finally {
        readline.close()
    }
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        options: {
            name: { type: 'string' },
            description: { type: 'string' },
            'no-install': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    })

    if (values.help) {
        console.log(usage())
        return
    }

    if (positionals.length > 1) {
        throw new Error('只能指定一个插件 id')
    }

    const id = positionals[0] ?? (await promptId())

    if (id.trim().length === 0) {
        throw new Error('插件 id 不能为空')
    }

    const result = await generatePlugin({
        id,
        name: values.name,
        description: values.description,
    })
    const relativeDirectory = join(PLUGIN_ROOT, result.id)

    console.log(`已生成插件模板: ${result.directory}\n`)

    for (const file of result.files) {
        console.log(`  ${join(relativeDirectory, file)}`)
    }

    if (!values['no-install']) {
        try {
            await installDependencies(result.directory)
        } catch (error) {
            console.error(
                `\n依赖安装失败: ${
                    error instanceof Error ? error.message : String(error)
                }`
            )
            console.error(
                `模板已保留，可以手动执行: npm install --prefix ${relativeDirectory}`
            )
            process.exitCode = 1
            return
        }
    }

    console.log(
        [
            '',
            '下一步：',
            ...(values['no-install']
                ? [`  npm install --prefix ${relativeDirectory}`]
                : []),
            `  npm run build --prefix ${relativeDirectory}`,
            '  node dist/app.js',
            '',
            `插件命令: /${result.id}`,
        ].join('\n')
    )
}

const entryPoint = process.argv[1]

if (
    entryPoint !== undefined &&
    resolve(entryPoint) === fileURLToPath(import.meta.url)
) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
