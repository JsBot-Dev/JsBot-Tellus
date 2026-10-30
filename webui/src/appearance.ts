/**
 * Appearance system — the single place that maps user preferences onto
 * `data-*` attributes and CSS custom properties on <html>.
 *
 * The shape and semantics mirror the pre-paint bootstrap in index.html:
 * mode, dark intensity, density, sidebar style, contrast, motion switches,
 * radius (rem) and UI scale. The bundle is the authoritative writer; the
 * bootstrap only serves the first paint.
 */

export type AppearanceMode = 'light' | 'dark'
export type DarkIntensity = 'soft' | 'black'
export type Density = 'compact' | 'cozy'
export type SidebarStyle = 'follow' | 'panel' | 'accent'

export interface UiAppearance {
    /** Resolved mode.`undefined` = 跟随系统 */
    mode?: AppearanceMode
    /** Dark canvas flavor; only meaningful while dark. */
    darkIntensity?: DarkIntensity
    /** Global rhythm; `cozy` is the default. */
    density?: Density
    /** How distinct the sidebar surface is from the main canvas. */
    sidebarStyle?: SidebarStyle
    /** Strengthen borders + dim-text contrast for legibility. */
    highContrast?: boolean
    /** Collapse animations/transitions to near-zero. */
    reduceMotion?: boolean
    /** Remove CSS animations outright (pulsing dots stop). */
    disableMotion?: boolean
    /** Corner radius in rem: 0–2. */
    radius?: number
    /** Root font-size factor 0.5–2 (rem-based sizes track it). */
    uiScale?: number
}

const APPEARANCE_KEY = 'jsbot-webui-appearance'
const LEGACY_THEME_KEY = 'jsbot-webui-theme'

type ViewTransitionDocument = Document & {
    startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

const clamp = (value: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, value))

const asBoolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined

const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[]
): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined)

export function normalizeAppearance(raw: unknown): UiAppearance {
    if (raw === null || typeof raw !== 'object') return {}

    const a = raw as Record<string, unknown>

    const radius =
        typeof a.radius === 'number' && a.radius >= 0 && a.radius <= 2
            ? a.radius
            : undefined
    const uiScale =
        typeof a.uiScale === 'number' && a.uiScale >= 0.5 && a.uiScale <= 2
            ? a.uiScale
            : undefined

    return {
        mode: pick(a.mode, ['light', 'dark']),
        darkIntensity: pick(a.darkIntensity, ['soft', 'black']),
        density: pick(a.density, ['compact', 'cozy']),
        sidebarStyle: pick(a.sidebarStyle, ['follow', 'panel', 'accent']),
        highContrast: asBoolean(a.highContrast),
        reduceMotion: asBoolean(a.reduceMotion),
        disableMotion: asBoolean(a.disableMotion),
        radius,
        uiScale,
    }
}

let current: UiAppearance = {}

const listeners = new Set<() => void>()

export function getAppearance(): UiAppearance {
    return current
}

export function subscribeAppearance(listener: () => void): () => void {
    listeners.add(listener)

    return () => {
        listeners.delete(listener)
    }
}

export function currentMode(): AppearanceMode {
    return document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light'
}

export function resolvedMode(appearance: UiAppearance): AppearanceMode {
    if (appearance.mode !== undefined) return appearance.mode

    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
}

function writeStored(appearance: UiAppearance): void {
    try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance))
    } catch {
        // Storage unavailable (private mode etc.); keep in memory only.
    }
}

function readStored(): UiAppearance {
    try {
        const raw = localStorage.getItem(APPEARANCE_KEY)

        if (raw !== null) return normalizeAppearance(JSON.parse(raw))

        // Migrate the pre-appearance theme toggle so nobody loses their pick.
        const legacy = localStorage.getItem(LEGACY_THEME_KEY)

        if (legacy === 'light' || legacy === 'dark') return { mode: legacy }
    } catch {
        // Ignore malformed storage; fall back to defaults.
    }

    return {}
}

/**
 * Apply every appearance value. The motion/contrast attributes are always
 * `data-…` present so CSS never has to guess between absent and default.
 */
export function applyAppearance(appearance: UiAppearance): void {
    const root = document.documentElement
    const mode = resolvedMode(appearance)

    root.classList.remove('light', 'dark')
    root.classList.add(mode)
    root.setAttribute('data-theme', mode)
    root.style.colorScheme = mode

    const themeMeta = document.querySelector('meta[name="theme-color"]')

    if (themeMeta !== null) {
        themeMeta.setAttribute(
            'content',
            mode === 'dark' ? '#0a0f1a' : '#f4f7fb'
        )
    }

    if (mode === 'dark' && appearance.darkIntensity !== undefined) {
        root.setAttribute('data-dark-intensity', appearance.darkIntensity)
    } else {
        root.removeAttribute('data-dark-intensity')
    }

    if (appearance.density !== undefined && appearance.density !== 'cozy') {
        root.setAttribute('data-density', appearance.density)
    } else {
        root.removeAttribute('data-density')
    }

    if (
        appearance.sidebarStyle !== undefined &&
        appearance.sidebarStyle !== 'follow'
    ) {
        root.setAttribute('data-sidebar-style', appearance.sidebarStyle)
    } else {
        root.removeAttribute('data-sidebar-style')
    }

    root.setAttribute(
        'data-contrast',
        appearance.highContrast === true ? 'high' : 'normal'
    )

    const systemReduce = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
    ).matches

    root.setAttribute(
        'data-reduce-motion',
        appearance.reduceMotion === true || systemReduce ? '1' : '0'
    )

    if (appearance.disableMotion === true) {
        root.setAttribute('data-no-motion', '1')
    } else {
        root.removeAttribute('data-no-motion')
    }

    if (appearance.radius !== undefined) {
        root.style.setProperty('--app-radius', `${appearance.radius}rem`)
    } else {
        root.style.removeProperty('--app-radius')
    }

    if (appearance.uiScale !== undefined) {
        root.style.fontSize = `${Math.round(16 * appearance.uiScale * 100) / 100}px`
    } else {
        root.style.removeProperty('font-size')
    }
}

export function setAppearance(patch: UiAppearance): UiAppearance {
    current = normalizeAppearance({ ...current, ...patch })

    // 清除被显式设回默认的字段，避免存储里堆出一堆“默认值”
    if (current.density === 'cozy') delete current.density
    if (current.sidebarStyle === 'follow') delete current.sidebarStyle
    if (current.highContrast !== true) delete current.highContrast
    if (current.reduceMotion !== true) delete current.reduceMotion
    if (current.disableMotion !== true) delete current.disableMotion

    applyAppearance(current)
    writeStored(current)
    listeners.forEach((listener) => listener())

    return current
}

export function resetAppearance(): UiAppearance {
    current = {}

    applyAppearance(current)
    writeStored(current)
    listeners.forEach((listener) => listener())

    return current
}

/**
 * Mode changes ride the View Transitions API as a circular wipe from the
 * click point when available (unsupported browsers / reduced motion swap
 * instantly).
 */
export function setMode(
    mode: AppearanceMode,
    origin?: { x: number; y: number }
): void {
    const doc = document as ViewTransitionDocument
    const canReveal =
        typeof doc.startViewTransition === 'function' &&
        origin !== undefined &&
        document.documentElement.getAttribute('data-reduce-motion') !== '1' &&
        current.disableMotion !== true

    if (!canReveal) {
        setAppearance({ mode })

        return
    }

    doc.startViewTransition?.(() => {
        setAppearance({ mode })
    })?.ready.then(() => {
        const x = origin?.x ?? window.innerWidth / 2
        const y = origin?.y ?? window.innerHeight / 2
        const radius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        )

        document.documentElement.style.setProperty('--vt-x', `${x}px`)
        document.documentElement.style.setProperty('--vt-y', `${y}px`)
        document.documentElement.style.setProperty('--vt-r', `${radius}px`)
    })
}

export function toggleMode(origin?: { x: number; y: number }): AppearanceMode {
    const mode: AppearanceMode = currentMode() === 'dark' ? 'light' : 'dark'

    setMode(mode, origin)

    return mode
}

/**
 * Before the app renders: load stored appearance (migrating the legacy theme
 * key) and mirror it onto <html>. Keep in sync with the index.html bootstrap.
 */
export function initAppearance(): UiAppearance {
    current = readStored()
    applyAppearance(current)

    return current
}
