import { randomUUID } from 'node:crypto'
import { copyFile, rename, stat, writeFile } from 'node:fs/promises'

/**
 * Write a file atomically, keeping the previous contents in `<path>.bak` and
 * preserving the existing file mode when possible.
 */
export async function atomicWrite(
    filePath: string,
    raw: string
): Promise<void> {
    let mode: number | undefined

    try {
        mode = (await stat(filePath)).mode & 0o777
    } catch {
        mode = undefined
    }

    const temporary = `${filePath}.tmp-${randomUUID()}`

    await writeFile(temporary, raw, {
        encoding: 'utf8',
        ...(mode !== undefined ? { mode } : {}),
    })

    try {
        await copyFile(filePath, `${filePath}.bak`)
    } catch {
        // Missing source file; nothing to back up.
    }

    await rename(temporary, filePath)
}

/**
 * Restore exact contents without touching the backup file.
 */
export async function restoreRaw(filePath: string, raw: string): Promise<void> {
    const temporary = `${filePath}.tmp-${randomUUID()}`

    await writeFile(temporary, raw, 'utf8')
    await rename(temporary, filePath)
}
