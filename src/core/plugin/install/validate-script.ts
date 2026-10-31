export const VALIDATE_SCRIPT_FILE = 'validate.mjs'

export const VALIDATE_SCRIPT = `import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = process.argv[2]

if (!directory) {
    console.error('missing plugin directory')
    process.exit(2)
}

const extensions = new Set(['.js', '.mjs', '.cjs'])

async function filesIn(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    const files = []

    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const path = join(directory, entry.name)

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue
            files.push(...(await filesIn(path)))
            continue
        }

        if (
            entry.isFile() &&
            extensions.has(extname(entry.name)) &&
            !/\\.d\\.(ts|mts|cts)$/.test(entry.name)
        ) {
            files.push(path)
        }
    }

    return files
}

function isPlugin(value) {
    if (typeof value !== 'object' || value === null) return false
    if (!('manifest' in value) || !('setup' in value)) return false

    const manifest = value.manifest

    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        typeof manifest.id !== 'string' ||
        typeof manifest.configSchema !== 'object' ||
        manifest.configSchema === null ||
        typeof manifest.configSchema.safeParse !== 'function' ||
        typeof value.setup !== 'function'
    ) {
        return false
    }

    if (
        manifest.dependencies !== undefined &&
        (!Array.isArray(manifest.dependencies) ||
            manifest.dependencies.some((item) => typeof item !== 'string'))
    ) {
        return false
    }

    return true
}

function collect(value, result) {
    if (Array.isArray(value)) {
        for (const item of value) collect(item, result)
        return
    }

    if (isPlugin(value)) {
        result.push(value)
        return
    }

    if (
        typeof value === 'object' &&
        value !== null &&
        'plugins' in value &&
        Array.isArray(value.plugins)
    ) {
        for (const item of value.plugins) collect(item, result)
    }
}

const files = await filesIn(directory).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(3)
})

if (files.length === 0) {
    console.error('插件 dist 目录中没有可加载的文件')
    process.exit(4)
}

const found = []
const invalid = []

for (const file of files) {
    let imported

    try {
        imported = await import(pathToFileURL(file).href)
    } catch (error) {
        invalid.push(
            \`failed to import \${file}: \${error instanceof Error ? error.message : String(error)}\`
        )
        continue
    }

    if (typeof imported !== 'object' || imported === null) continue

    for (const candidate of [imported.default, imported.plugin, imported.plugins]) {
        collect(candidate, found)
    }
}

const unique = found.filter((plugin, index) => found.indexOf(plugin) === index)

if (unique.length === 0) {
    console.error(
        invalid[0] ??
            'package does not export a JsBot plugin (default / plugin / plugins)'
    )
    process.exit(5)
}

console.log(
    '__JSBOT_PLUGIN__' +
        JSON.stringify(
            unique.map((plugin) => ({
                id: plugin.manifest.id,
                version:
                    typeof plugin.manifest.version === 'string'
                        ? plugin.manifest.version
                        : '0.0.0',
                dependencies: Array.isArray(plugin.manifest.dependencies)
                    ? plugin.manifest.dependencies.filter(
                          (item) => typeof item === 'string'
                      )
                    : [],
            }))
        )
)
`
