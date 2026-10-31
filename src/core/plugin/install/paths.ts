import { readFileSync } from 'node:fs'
import { mkdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VALIDATE_SCRIPT, VALIDATE_SCRIPT_FILE } from './validate-script.js'

export const CORE_PACKAGE_NAME = '@jsbot-tellus/core'

export function packageDirectoryName(name: string): string {
    return name.startsWith('@') ? name.replace('/', '__') : name
}

export function corePackageRoot(): string {
    let current = dirname(fileURLToPath(import.meta.url))

    for (;;) {
        try {
            const manifest = JSON.parse(
                readFileSync(join(current, 'package.json'), 'utf8')
            ) as Record<string, unknown>

            if (manifest['name'] === CORE_PACKAGE_NAME) return current
        } catch {
            // keep walking up
        }

        const parent = dirname(current)

        if (parent === current) {
            throw new Error(`cannot locate ${CORE_PACKAGE_NAME} package root`)
        }

        current = parent
    }
}

export async function ensureCoreLink(dir: string): Promise<void> {
    const target = corePackageRoot()
    const link = join(dir, 'node_modules', '@jsbot-tellus', 'core')

    await mkdir(dirname(link), { recursive: true })

    const existing = await realpath(link).catch(() => null)

    if (existing !== null) {
        const resolvedTarget = await realpath(target).catch(() => target)

        if (existing === resolvedTarget) return

        await rm(link, { recursive: true, force: true })
    }

    await symlink(
        target,
        link,
        process.platform === 'win32' ? 'junction' : 'dir'
    )
}

export async function pathExists(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null)) !== null
}

export async function ensureInstallRoot(root: string): Promise<void> {
    await mkdir(root, { recursive: true })
    await mkdir(join(root, '.jsbot'), { recursive: true })
    await writeFile(
        join(root, '.jsbot', VALIDATE_SCRIPT_FILE),
        VALIDATE_SCRIPT,
        'utf8'
    )
}
