interface ParsedVersion {
    major: number
    minor: number
    patch: number
    prerelease: string[]
}

const VERSION_PATTERN =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(value: string): ParsedVersion | null {
    const match = VERSION_PATTERN.exec(value.trim())

    if (match === null) return null

    const [, major, minor, patch, prerelease] = match

    if (major === undefined || minor === undefined || patch === undefined) {
        return null
    }

    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        prerelease:
            prerelease === undefined || prerelease.length === 0
                ? []
                : prerelease.split('.'),
    }
}

function comparePrerelease(left: string[], right: string[]): number {
    if (left.length === 0 && right.length === 0) return 0
    if (left.length === 0) return 1
    if (right.length === 0) return -1

    const length = Math.max(left.length, right.length)

    for (let index = 0; index < length; index += 1) {
        const a = left[index]
        const b = right[index]

        if (a === undefined) return -1
        if (b === undefined) return 1
        if (a === b) continue

        const aNumeric = /^\d+$/.test(a)
        const bNumeric = /^\d+$/.test(b)

        if (aNumeric && bNumeric) {
            const leftNumber = Number(a)
            const rightNumber = Number(b)

            return leftNumber === rightNumber
                ? 0
                : leftNumber < rightNumber
                  ? -1
                  : 1
        }

        if (aNumeric) return -1
        if (bNumeric) return 1

        return a < b ? -1 : 1
    }

    return 0
}

export function isValidVersion(value: string): boolean {
    return parseVersion(value) !== null
}

export function compareVersions(left: string, right: string): number | null {
    const a = parseVersion(left)
    const b = parseVersion(right)

    if (a === null || b === null) return null

    if (a.major !== b.major) return a.major < b.major ? -1 : 1
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1

    return comparePrerelease(a.prerelease, b.prerelease)
}

export function isNewerVersion(candidate: string, current: string): boolean {
    const compared = compareVersions(candidate, current)

    return compared === null
        ? candidate.trim() !== current.trim()
        : compared > 0
}
