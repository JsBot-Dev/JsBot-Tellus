#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ACTIONS = new Set(['build', 'check'])
const action = process.argv[2]

if (!ACTIONS.has(action)) {
    console.error('Usage: node scripts/plugins.mjs <build|check>')
    process.exit(1)
}

const root = join(import.meta.dirname, '..', 'plugins')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function isDirectory(path) {
    return (await stat(path).catch(() => null))?.isDirectory() ?? false
}

async function isFile(path) {
    return (await stat(path).catch(() => null))?.isFile() ?? false
}

function run(command, args) {
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, { stdio: 'inherit' })

        child.on('error', (error) => {
            console.error(error.message)
            resolvePromise(1)
        })
        child.on('close', (code) => resolvePromise(code ?? 1))
    })
}

const plugins = []

for (const entry of (
    await readdir(root, { withFileTypes: true }).catch(() => [])
)
    .filter((value) => value.isDirectory() && !value.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = join(root, entry.name)

    if (
        !(await isFile(join(directory, 'package.json'))) ||
        !(await isFile(join(directory, 'tsconfig.json'))) ||
        !(await isDirectory(join(directory, 'src')))
    ) {
        continue
    }

    const manifest = JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8')
    )
    const script = manifest.scripts?.[action]

    if (typeof script !== 'string') continue

    if (!(await isDirectory(join(directory, 'node_modules')))) {
        console.warn(
            `skip ${relative(process.cwd(), directory)}: node_modules not installed`
        )
        continue
    }

    plugins.push({
        directory,
        name: typeof manifest.name === 'string' ? manifest.name : entry.name,
    })
}

if (plugins.length === 0) {
    console.log(`no plugins to ${action}`)
    process.exit(0)
}

for (const plugin of plugins) {
    console.log(
        `\n> ${action} ${plugin.name} (${relative(process.cwd(), plugin.directory)})`
    )

    const code = await run(npm, ['run', action, '--prefix', plugin.directory])

    if (code !== 0) process.exit(code)
}

console.log(`\n${action} completed for ${plugins.length} plugin(s)`)
