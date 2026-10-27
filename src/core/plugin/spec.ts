export interface PackageSpec {
    name: string
    version?: string | undefined
    raw: string
}

export class PackageSpecError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PackageSpecError'
    }
}

const NAME_PATTERN =
    /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i

const EXACT_VERSION_PATTERN =
    /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i

const DIST_TAG_PATTERN = /^[a-z][a-z0-9._-]*$/i

const MAX_LENGTH = 240

function isValidVersionOrTag(value: string): boolean {
    return EXACT_VERSION_PATTERN.test(value) || DIST_TAG_PATTERN.test(value)
}

export function parsePackageSpec(input: string): PackageSpec {
    const raw = input.trim()

    if (raw.length === 0) {
        throw new PackageSpecError('包名不能为空')
    }

    if (raw.length > MAX_LENGTH) {
        throw new PackageSpecError('包名过长')
    }

    if (raw.includes('\\') || /\s/.test(raw)) {
        throw new PackageSpecError(`非法的包名: ${raw}`)
    }

    if (raw.includes(':')) {
        throw new PackageSpecError(
            '只支持 npm registry 包，不支持 git/url/file 等来源'
        )
    }

    const separator = raw.lastIndexOf('@')
    const name = separator > 0 ? raw.slice(0, separator) : raw
    const version = separator > 0 ? raw.slice(separator + 1) : undefined

    if (!NAME_PATTERN.test(name)) {
        throw new PackageSpecError(`非法的包名: ${name}`)
    }

    if (version !== undefined) {
        if (!isValidVersionOrTag(version)) {
            throw new PackageSpecError(
                `非法的版本或 tag: ${version}（只支持精确版本或 dist-tag）`
            )
        }
    }

    return {
        name,
        ...(version !== undefined ? { version } : {}),
        raw,
    }
}

export function isPackageAllowed(
    name: string,
    allowedPackages: readonly string[]
): boolean {
    if (allowedPackages.length === 0) return true

    return allowedPackages.some((entry) => {
        if (entry === name) return true

        if (entry.endsWith('/*')) {
            return name.startsWith(entry.slice(0, -1))
        }

        return false
    })
}
