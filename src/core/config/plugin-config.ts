import { createHash } from 'node:crypto'
import { readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import {
    formatConfigIssues,
    pluginEnvelopeSchema,
    type PluginEnvelope,
} from './schema.js'
import { atomicWrite, restoreRaw } from './atomic.js'

const PLUGIN_CONFIG_DIRECTORY = 'config/plugin'
const PLUGIN_CONFIG_EXTENSION = '.jsonc'

export interface PluginConfigDocument {
    id: string
    path: string
    raw: string | null
    hash: string | null
    config: PluginEnvelope
    error: string | null
    /** True when the file is missing or contains no configuration. */
    missing: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code

    return code === 'ENOENT' || code === 'ENOTDIR'
}

function hashOf(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
}

function encodePluginId(id: string): string {
    return encodeURIComponent(id).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
}

function decodePluginId(encoded: string): string {
    try {
        return decodeURIComponent(encoded)
    } catch {
        return encoded
    }
}

function formatParseError(raw: string, error: ParseError): string {
    const before = raw.slice(0, error.offset)
    const line = before.split('\n').length
    const column = error.offset - before.lastIndexOf('\n')

    return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`
}

export function resolvePluginConfigDir(dataDir: string): string {
    return join(resolve(dataDir), PLUGIN_CONFIG_DIRECTORY)
}

export function pluginConfigFilePath(dir: string, id: string): string {
    return join(dir, `${encodePluginId(id)}${PLUGIN_CONFIG_EXTENSION}`)
}

function emptyDocument(
    id: string,
    path: string,
    raw: string | null,
    options: { error?: string | null; missing?: boolean } = {}
): PluginConfigDocument {
    return {
        id,
        path,
        raw,
        hash: raw === null ? null : hashOf(raw),
        config: {},
        error: options.error ?? null,
        missing: options.missing ?? raw === null,
    }
}

async function readPluginConfigFile(
    filePath: string,
    id: string
): Promise<PluginConfigDocument> {
    let raw: string

    try {
        raw = await readFile(filePath, 'utf8')
    } catch (error) {
        if (isNotFound(error)) return emptyDocument(id, filePath, null)

        return emptyDocument(id, filePath, null, {
            error: `cannot read plugin config ${filePath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        })
    }

    if (raw.trim().length === 0) {
        return emptyDocument(id, filePath, raw, { missing: true })
    }

    const errors: ParseError[] = []
    const text = raw.replace(/^\uFEFF/, '')
    const value = parse(text, errors, {
        allowTrailingComma: true,
        allowEmptyContent: true,
    }) as unknown

    if (errors.length > 0) {
        const first = errors[0] as ParseError

        return emptyDocument(id, filePath, raw, {
            error: `invalid JSONC in ${filePath}: ${formatParseError(text, first)}`,
        })
    }

    if (value === undefined) {
        // Comment-only file: treat it like an empty config.
        return emptyDocument(id, filePath, raw, { missing: true })
    }

    if (!isRecord(value)) {
        return emptyDocument(id, filePath, raw, {
            error: `plugin config must be a JSON object: ${filePath}`,
        })
    }

    const parsed = pluginEnvelopeSchema.safeParse(value)

    if (!parsed.success) {
        return emptyDocument(id, filePath, raw, {
            error: [
                `invalid plugin config in ${filePath}`,
                formatConfigIssues(parsed.error),
            ].join('\n'),
        })
    }

    return {
        id,
        path: filePath,
        raw,
        hash: hashOf(raw),
        config: parsed.data,
        error: null,
        missing: false,
    }
}

export function readPluginConfig(
    dir: string,
    id: string
): Promise<PluginConfigDocument> {
    return readPluginConfigFile(pluginConfigFilePath(dir, id), id)
}

export async function readPluginConfigs(
    dir: string
): Promise<PluginConfigDocument[]> {
    let entries

    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
        if (isNotFound(error)) return []
        throw error
    }

    const names = entries
        .filter(
            (entry) =>
                entry.isFile() &&
                !entry.name.startsWith('.') &&
                entry.name.endsWith(PLUGIN_CONFIG_EXTENSION)
        )
        .map((entry) => entry.name)
        .sort()

    const documents = await Promise.all(
        names.map((name) => {
            const encoded = name.slice(0, -PLUGIN_CONFIG_EXTENSION.length)

            return readPluginConfigFile(
                join(dir, name),
                decodePluginId(encoded)
            )
        })
    )

    return documents.sort((a, b) => a.id.localeCompare(b.id))
}

export async function writePluginConfig(
    dir: string,
    id: string,
    value: unknown
): Promise<void> {
    await mkdir(dir, { recursive: true })

    const raw = `${JSON.stringify(value, null, 4)}\n`

    await atomicWrite(pluginConfigFilePath(dir, id), raw)
}

export async function restorePluginConfig(
    dir: string,
    id: string,
    raw: string | null
): Promise<void> {
    const filePath = pluginConfigFilePath(dir, id)

    if (raw === null) {
        await rm(filePath, { force: true })
        return
    }

    await restoreRaw(filePath, raw)
}
