<template>
    <div class="term container">
        <section class="term-content">
            <header class="term-bar">
                <div class="term-traffic">
                    <span class="dot" />
                    <span class="dot" />
                    <span class="dot" />
                </div>

                <span class="term-title">
                    bot://console<span class="dim">
                        · {{ live === 'on' ? 'streaming' : 'paused' }}
                    </span>
                </span>

                <span class="term-spacer" />

                <el-select
                    v-model="level"
                    placeholder="级别"
                    clearable
                    class="ctl sel-level"
                    @change="load"
                >
                    <el-option label="all" value="" />
                    <el-option label="debug" value="debug" />
                    <el-option label="info" value="info" />
                    <el-option label="warn" value="warn" />
                    <el-option label="error" value="error" />
                </el-select>

                <el-input
                    v-model="scope"
                    placeholder="scope"
                    class="ctl"
                    @keyup.enter="load"
                />

                <el-input
                    v-model="query"
                    placeholder="关键字"
                    class="ctl"
                    @keyup.enter="load"
                />

                <el-select v-model="live" class="ctl sel-live">
                    <el-option label="stream" value="on" />
                    <el-option label="paused" value="off" />
                </el-select>

                <el-button
                    class="ctl refresh"
                    text
                    :icon="Refresh"
                    @click="load"
                >
                    查询
                </el-button>
            </header>

            <main
                ref="scrollEl"
                class="term-body log-fade-both"
                @scroll="onScroll"
            >
                <div v-if="items.length === 0" class="term-empty">
                    — 暂无日志：试试调整筛选或点击「查询」 —
                </div>

                <div
                    v-for="(entry, index) in visible"
                    :key="entry.key"
                    class="log-row"
                    :class="[`l-${entry.level}`, entry.fresh ? 'rowIn' : '']"
                >
                    <span class="lt">{{ shortTime(entry.time) }}</span>
                    <span class="lv">{{ entry.level.toUpperCase() }}</span>
                    <span v-if="entry.scope" class="ls"
                        >[{{ entry.scope }}]</span
                    >
                    <span class="lm">{{ entry.text }}</span>
                </div>
            </main>

            <transition name="pill">
                <button
                    v-if="!pinned && items.length > 0"
                    class="jump-latest"
                    @click="jumpLatest"
                >
                    ↓ 回到最新{{
                        offscreenCount > 0 ? `（+${offscreenCount}）` : ''
                    }}
                </button>
            </transition>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { apiGet, connectSse, showError, type LogEntryItem } from '@/api'

interface TermEntry {
    key: string
    time: number
    level: string
    scope: string
    text: string
    fresh: boolean
}

const level = ref('')
const scope = ref('')
const query = ref('')
const live = ref('on')

const items = ref<TermEntry[]>([])
const scrollEl = ref<HTMLElement | null>(null)
const pinned = ref(true)

const MAX_RENDER = 500
/* 批量刷新（旋转缓冲/整页回填）时只把真尾巴一小段当「新到达」，避免整屏闪动 */
const MAX_FRESH_ROWS = 30

const buildEntry = (raw: LogEntryItem): TermEntry => ({
    key: `${raw.time}|${raw.scope}|${raw.level}|${raw.message}`,
    time: raw.time,
    level: raw.level,
    scope: raw.scope,
    text: raw.message + (raw.args.length > 0 ? ' ' + raw.args.join(' ') : ''),
    fresh: false,
})

const visible = computed(() => items.value.slice(-MAX_RENDER))
const offscreenCount = computed(() =>
    Math.max(0, items.value.length - MAX_RENDER)
)

const search = (): string => {
    const params = new URLSearchParams({ limit: '500' })

    if (level.value) params.set('level', level.value)
    if (scope.value) params.set('scope', scope.value)
    if (query.value) params.set('query', query.value)

    return `/api/logs?${params.toString()}`
}

const shortTime = (value: number): string => {
    if (Number.isNaN(value)) return '--:--:--'

    const date = new Date(value)

    return date.toTimeString().slice(0, 8)
}

const scrollToEnd = (): void => {
    const element = scrollEl.value

    if (element === null) return

    element.scrollTop = element.scrollHeight
}

const isAtBottom = (): boolean => {
    const element = scrollEl.value

    if (element === null) return true

    return element.scrollHeight - element.scrollTop - element.clientHeight < 32
}

const onScroll = (): void => {
    pinned.value = isAtBottom()
}

const jumpLatest = (): void => {
    pinned.value = true
    scrollToEnd()
}

const applyEntries = (raw: LogEntryItem[]): void => {
    // 新行标记：与上一批键交集之外都算「真实到来」，只给尾部一段行做入场
    // 动画，批量回填/缓冲轮换时不会整屏闪动。
    const previousKeys = new Set(items.value.map((entry) => entry.key))

    // 同一毫秒下完全相同的重复行会撞 key，用出现序号消歧（顺序稳定，
    // 因此跨刷新生成的键仍然一致）。
    const seen = new Map<string, number>()

    const next = raw.slice(-MAX_RENDER).map((entry) => {
        const built = buildEntry(entry)
        const count = seen.get(built.key) ?? 0

        seen.set(built.key, count + 1)
        built.key = count > 0 ? `${built.key}#${count}` : built.key

        return built
    })

    let firstNewIndex = next.length

    for (let i = next.length - 1; i >= 0; i -= 1) {
        if (previousKeys.has(next[i]?.key ?? '')) {
            firstNewIndex = i + 1
            break
        }
    }

    for (let i = 0; i < next.length; i += 1) {
        next[i] = {
            ...next[i],
            fresh: i >= firstNewIndex && i >= next.length - MAX_FRESH_ROWS,
        }
    }

    items.value = next

    if (pinned.value) {
        void nextTick(scrollToEnd)
    }
}

const load = async (): Promise<void> => {
    try {
        const data = await apiGet<LogEntryItem[]>(search())

        applyEntries(data)
    } catch (error) {
        showError(error)
    }
}

let closeSse: (() => void) | null = null

const reopen = (): void => {
    closeSse?.()
    closeSse = null

    if (live.value !== 'on') return

    closeSse = connectSse('/api/logs/stream', () => {
        // SSE 只报告「有新日志」：拉一份尾部，保持跟随。
        void apiGet<LogEntryItem[]>(search())
            .then((data) => {
                applyEntries(data)
            })
            .catch(() => {})
    })
}

watch(live, reopen)

onMounted(async () => {
    await load()
    scrollToEnd()
    reopen()
})

onUnmounted(() => {
    closeSse?.()
})
</script>

<style scoped>
/*
 * Independent dark canvas: the terminal keeps its own deep deck (darker than
 * even the dark theme — closer to "black" intensity) in BOTH themes.
 * Re-declaring the --app and --el token groups on .term-content pushes the
 * dark values into the whole subtree via inheritance; popper teleports
 * outside stay theme-colored.
 */
.term-content {
    --app-bg: oklch(13% 0.012 250);
    --app-panel: oklch(17% 0.02 250);
    --app-panel-2: oklch(21% 0.02 250);
    --app-field: oklch(19% 0.015 250);
    --app-text: oklch(95% 0.01 240);
    --app-muted: oklch(65% 0.02 240);
    --app-border: oklch(27% 0.02 250);
    --app-border-strong: oklch(33% 0.022 250);
    --app-field-border: oklch(25% 0.02 250);
    --app-field-border-hover: oklch(35% 0.022 250);

    --app-accent: oklch(75% 0.14 230);
    --app-accent-fg: oklch(15% 0.02 250);
    --app-accent-soft: oklch(30% 0.06 230);
    --app-accent-ring: oklch(75% 0.14 230 / 0.25);

    --app-ok: oklch(72% 0.15 160);
    --app-warn: oklch(80% 0.16 80);
    --app-danger: oklch(62% 0.2 27);
    --app-violet: oklch(74% 0.11 295);
    --app-log-info: oklch(75% 0.14 230);
    --app-log-success: oklch(72% 0.15 160);
    --app-log-warn: oklch(80% 0.16 80);
    --app-log-error: oklch(62% 0.2 27);

    --app-dot-off: oklch(40% 0.015 250);

    --card-shadow:
        0 1px 2px oklch(0% 0 0 / 0.36), 0 16px 38px -24px oklch(0% 0 0 / 0.72),
        inset 0 1px oklch(100% 0 0 / 0.025);
    --app-pop-shadow:
        0 1px 2px oklch(0% 0 0 / 0.4), 0 16px 40px -18px oklch(0% 0 0 / 0.75);

    --el-bg-color: var(--app-panel);
    --el-bg-color-overlay: oklch(19% 0.018 250);
    --el-bg-color-page: var(--app-bg);
    --el-fill-color: var(--app-panel-2);
    --el-fill-color-light: oklch(23% 0.02 250);
    --el-fill-color-lighter: oklch(25% 0.02 250);
    --el-fill-color-blank: var(--app-panel);
    --el-text-color-primary: var(--app-text);
    --el-text-color-regular: var(--app-text);
    --el-text-color-secondary: var(--app-muted);
    --el-text-color-placeholder: color-mix(
        in oklab,
        var(--app-muted) 72%,
        transparent
    );
    --el-border-color: var(--app-border);
    --el-border-color-lighter: color-mix(
        in srgb,
        var(--app-border) 78%,
        transparent
    );
    --el-border-color-extra-light: color-mix(
        in srgb,
        var(--app-border) 62%,
        transparent
    );

    display: flex;
    flex-direction: column;
    height: calc(100vh - 192px);
    min-height: 420px;
    position: relative;
    border: 1px solid var(--app-border);
    border-radius: calc(var(--app-radius) + 2px);
    background: var(--app-bg);
    box-shadow: var(--card-shadow);
    overflow: hidden;
    scrollbar-gutter: stable both-edges;
}

.container {
    display: flex;
    flex-direction: column;
}

.term-bar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex: none;
    padding: 8px 12px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-panel);
}

.term-traffic {
    display: flex;
    gap: 6px;
    flex: none;
}

.dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--app-dot-off);
    opacity: 0.55;
}

.term-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--app-text);
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
}

.term-title .dim {
    color: var(--app-muted);
    font-weight: 400;
}

.term-spacer {
    flex: 1;
}

.ctl {
    width: 128px;
    flex: none;
}

.sel-level {
    width: 108px;
}

.sel-live {
    width: 104px;
}

.refresh {
    width: auto;
}

/* Body — the actual terminal canvas */
.term-body {
    position: relative;
    flex: 1;
    padding: 10px 14px 14px;
    overflow-y: auto;
    font-family:
        'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono',
        monospace;
    font-size: 12px;
    line-height: 1.7;
    font-variant-numeric: tabular-nums;
    scrollbar-color: color-mix(in oklab, var(--app-text) 22%, transparent)
        transparent;
}

.term-empty {
    padding: 48px 0;
    text-align: center;
    color: var(--app-muted);
    font-size: 12px;
}

.log-row {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 0 6px;
    border-radius: 6px;
    content-visibility: auto;
    contain-intrinsic-size: auto 24px;
    white-space: pre-wrap;
    word-break: break-word;
}

.log-row:hover {
    background: color-mix(in oklab, var(--app-accent) 6%, transparent);
}

.lt {
    flex: none;
    color: color-mix(in oklab, var(--app-muted) 70%, transparent);
}

.lv {
    flex: none;
    width: 52px;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.02em;
}

.ls {
    flex: none;
    color: color-mix(in oklab, var(--app-muted) 85%, transparent);
}

.lm {
    min-width: 0;
    color: var(--app-text);
}

/* Level colors follow the log tokens; debug dims instead of shouting. */
.l-debug .lv,
.l-debug .lm {
    color: color-mix(in oklab, var(--app-muted) 78%, transparent);
}

.l-info .lv {
    color: var(--app-log-info);
}

.l-warn .lv {
    color: var(--app-log-warn);
}

.l-error .lv {
    color: var(--app-log-error);
}

.l-error .lm {
    color: var(--app-log-error);
}

/* Edge fades — bottom works
   like the terminal's Apple-style dissolve at scroll boundaries.
   Position-aware: JS shows/hides nothing here; the mask reads fine in both
   extremes since content only fades near the very edge. */
.log-fade-both {
    mask-image: linear-gradient(
        to bottom,
        transparent 0,
        #fff 12px,
        #fff calc(100% - 16px),
        transparent 100%
    );
}

/* Tail entrance: fade + rise, only on genuinely new rows. */
.rowIn {
    animation: terminal-row-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes terminal-row-in {
    from {
        opacity: 0;
        transform: translateY(6px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Jump-to-latest pill */
.jump-latest {
    position: absolute;
    bottom: 14px;
    left: 50%;
    translate: -50% 0;
    padding: 6px 14px;
    border: 1px solid color-mix(in oklab, var(--app-border) 74%, transparent);
    border-radius: 999px;
    background: var(--el-bg-color-overlay);
    color: var(--app-accent);
    font-size: 12px;
    font-weight: 500;
    box-shadow: var(--app-pop-shadow);
    cursor: pointer;
    transition: opacity 0.15s ease;
}

.jump-latest:hover {
    border-color: color-mix(in oklab, var(--app-accent) 30%, transparent);
}

.pill-enter-active,
.pill-leave-active {
    transition:
        opacity 0.15s ease,
        translate 0.15s ease;
}

.pill-enter-from,
.pill-leave-to {
    opacity: 0;
    translate: -50% 6px;
}

@media (prefers-reduced-motion: reduce) {
    .rowIn {
        animation-duration: 0.01ms;
    }
}
</style>
