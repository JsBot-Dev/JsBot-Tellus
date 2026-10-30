<template>
    <div
        ref="root"
        class="adaptive-cursor"
        :data-visible="visible ? '1' : '0'"
        :data-mode="mode"
        :data-pressed="pressed ? '1' : '0'"
        aria-hidden="true"
    >
        <div ref="shape" class="adaptive-cursor-shape" />
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getAppearance } from '@/appearance'

/**
 * 雪色自适应光标：默认是小圆点；悬停可点击目标时按目标边界'扑'上去变成
 * 半透明描边块，进入文本区收窄成 I-beam 胶囊，拖拽/等待/禁用各有形态。
 * 仅在 hover:hover + pointer:fine 且未开启减少/关闭动效时武装；武装后隐藏
 * 原生光标（CSS: html[data-cursor-armed="1"] * { cursor: none }），组件卸载
 * 或武装失败时系统光标原样保留。
 */
type CursorMode =
    | 'default'
    | 'target'
    | 'text'
    | 'grab'
    | 'grabbing'
    | 'wait'
    | 'help'
    | 'not-allowed'

const TARGET_SELECTOR =
    'button, a[href], summary, select, label[for], ' +
    '[role="button"], [role="link"], [role="tab"], [role="checkbox"], ' +
    '[role="radio"], [role="switch"], [role="menuitem"], [role="option"], ' +
    '[data-cursor-target], .cursor-pointer'

const TEXT_SELECTOR =
    'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="image"]):not([type="hidden"]), ' +
    'textarea, [contenteditable="true"], pre, code'

const root = ref<HTMLElement | null>(null)
const shape = ref<HTMLElement | null>(null)
const visible = ref(false)
const pressed = ref(false)
const mode = ref<CursorMode>('default')

const motionAllowed = (): boolean => {
    const appearance = getAppearance()

    return (
        appearance.reduceMotion !== true &&
        appearance.disableMotion !== true &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
}

const resolveMode = (node: Element | null): CursorMode => {
    if (node === null) return 'default'

    if (
        node.closest(
            '[disabled], [aria-disabled="true"], .is-disabled, .cursor-not-allowed'
        ) !== null
    ) {
        return 'not-allowed'
    }

    if (node.closest('[aria-busy="true"], .cursor-wait') !== null) {
        return 'wait'
    }

    if (
        node.closest(
            'input[type="range"], [draggable="true"], .cursor-grab'
        ) !== null
    ) {
        return 'grab'
    }

    if (node.closest('.cursor-help') !== null) return 'help'
    if (node.closest(TEXT_SELECTOR) !== null) return 'text'
    if (node.closest(TARGET_SELECTOR) !== null) return 'target'

    return 'default'
}

/** closest() 返回匹配的元素本身，事件目标即命中目标，直接量边界。 */
const matchedElement = (
    event: PointerEvent,
    selector: string
): Element | null => {
    const node = event.target

    if (!(node instanceof Element)) return null
    if (node.matches(selector)) return node

    return node.closest(selector)
}

let trackFrame: number | null = null
let latest: {
    x: number
    y: number
    target: Element | null
    mode: CursorMode
} | null = null

const paint = (): void => {
    trackFrame = null

    if (root.value === null || shape.value === null || latest === null) return

    root.value.style.transform = `translate(${latest.x}px, ${latest.y}px)`
    mode.value = latest.mode
    visible.value = true

    if (latest.mode === 'target' && latest.target instanceof Element) {
        const bounds = latest.target.getBoundingClientRect()

        shape.value.style.setProperty(
            '--cursor-target-width',
            `${Math.max(bounds.width, 20)}px`
        )
        shape.value.style.setProperty(
            '--cursor-target-height',
            `${Math.max(bounds.height, 20)}px`
        )
        shape.value.style.setProperty(
            '--cursor-target-radius',
            `${Math.min(
                14,
                Number.parseFloat(
                    getComputedStyle(latest.target).borderRadius
                ) || 10
            )}px`
        )
    }
}

const schedulePaint = (event: PointerEvent): void => {
    latest = {
        x: event.clientX,
        y: event.clientY,
        target: matchedElement(event, TARGET_SELECTOR),
        mode: resolveMode(
            event.target instanceof Element ? event.target : null
        ),
    }

    if (trackFrame === null) trackFrame = window.requestAnimationFrame(paint)
}

const onPointerMove = (event: PointerEvent): void => {
    schedulePaint(event)

    if (event.buttons === 0) pressed.value = false
}

const onPointerDown = (): void => {
    pressed.value = true

    if (mode.value === 'grab') mode.value = 'grabbing'
}

const onPointerUp = (): void => {
    pressed.value = false

    if (mode.value === 'grabbing') mode.value = 'grab'
}

const onPointerLeave = (event: PointerEvent): void => {
    if (event.relatedTarget === null) {
        visible.value = false
        pressed.value = false
    }
}

const onWindowBlur = (): void => {
    visible.value = false
    pressed.value = false
}

let armed = false

const arm = (): void => {
    if (armed) return

    if (
        !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
        !motionAllowed()
    ) {
        return
    }

    armed = true
    document.documentElement.setAttribute('data-cursor-system', 'custom')
    document.documentElement.setAttribute('data-cursor-armed', '1')
    root.value?.style.setProperty('transform', 'translate(-120px, -120px)')

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })
    window.addEventListener('blur', onWindowBlur)
}

const disarm = (): void => {
    if (!armed) return

    armed = false
    document.documentElement.removeAttribute('data-cursor-system')
    document.documentElement.removeAttribute('data-cursor-armed')

    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointerleave', onPointerLeave)
    window.removeEventListener('blur', onWindowBlur)
}

onMounted(arm)
onUnmounted(disarm)
</script>

<style scoped>
.adaptive-cursor {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
    will-change: transform;
    transition-property: opacity;
    transition-duration: 120ms;
    transition-timing-function: ease-out;
}

.adaptive-cursor[data-visible='1'] {
    opacity: 1;
}

.adaptive-cursor-shape {
    --cursor-width: 1.125rem;
    --cursor-height: 1.125rem;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 82%, var(--app-text));
    --cursor-stroke: color-mix(in oklab, var(--app-accent) 34%, transparent);

    position: absolute;
    top: 0;
    left: 0;
    width: var(--cursor-width);
    height: var(--cursor-height);
    translate: -50% -50%;
    border: 1px solid var(--cursor-stroke);
    border-radius: 9999px;
    background: var(--cursor-fill);
    box-shadow:
        0 1px 3px oklch(0% 0 0 / 0.16),
        0 0 0 3px color-mix(in oklab, var(--app-bg) 34%, transparent);
    transition:
        width 0.18s cubic-bezier(0.2, 0, 0, 1),
        height 0.18s cubic-bezier(0.2, 0, 0, 1),
        border-radius 0.18s cubic-bezier(0.2, 0, 0, 1),
        background-color 0.18s cubic-bezier(0.2, 0, 0, 1),
        border-color 0.18s cubic-bezier(0.2, 0, 0, 1),
        box-shadow 0.18s cubic-bezier(0.2, 0, 0, 1),
        scale 0.18s cubic-bezier(0.2, 0, 0, 1);
}

[data-pressed='1'] .adaptive-cursor-shape {
    scale: 0.82;
}

/* 目标形态：圆点按 hover 目标的边界与圆角'贴'上去，变成半透明描边块 */
.adaptive-cursor[data-mode='target'] .adaptive-cursor-shape {
    width: var(--cursor-target-width, 1.125rem);
    height: var(--cursor-target-height, 1.125rem);
    --cursor-target-radius: 10px;
    border-radius: var(--cursor-target-radius);
    --cursor-fill: color-mix(in oklab, var(--app-accent) 14%, transparent);
    --cursor-stroke: color-mix(in oklab, var(--app-accent) 30%, transparent);
    box-shadow: 0 4px 18px -10px
        color-mix(in oklab, var(--app-accent) 56%, transparent);
}

.adaptive-cursor[data-mode='target'][data-pressed='1'] .adaptive-cursor-shape {
    scale: 0.96;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 24%, transparent);
}

/* 文本形态：窄 I-beam 胶囊 */
.adaptive-cursor[data-mode='text'] .adaptive-cursor-shape {
    width: 0.25rem;
    height: 1.75rem;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 84%, var(--app-text));
    --cursor-stroke: color-mix(in oklab, var(--app-bg) 48%, transparent);
    box-shadow:
        0 0 0 1px color-mix(in oklab, var(--app-bg) 52%, transparent),
        0 2px 8px color-mix(in oklab, var(--app-accent) 46%, transparent);
}

/* 拖拽形态：圆点收紧，按下再更小 */
.adaptive-cursor[data-mode='grab'] .adaptive-cursor-shape,
.adaptive-cursor[data-mode='grabbing'] .adaptive-cursor-shape {
    width: 1.5rem;
    height: 1.5rem;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 16%, var(--app-bg));
    --cursor-stroke: color-mix(in oklab, var(--app-accent) 52%, transparent);
}

.adaptive-cursor[data-mode='grabbing'] .adaptive-cursor-shape {
    width: 1.2rem;
    height: 1.2rem;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 30%, var(--app-bg));
}

/* 等待形态：CSS 环形 spinner */
.adaptive-cursor[data-mode='wait'] .adaptive-cursor-shape {
    width: 1.4rem;
    height: 1.4rem;
    --cursor-fill: color-mix(in oklab, var(--app-bg) 84%, transparent);
    --cursor-stroke: color-mix(in oklab, var(--app-accent) 22%, transparent);
    border-width: 2px;
}

.adaptive-cursor[data-mode='wait'] .adaptive-cursor-shape::before {
    content: '';
    position: absolute;
    inset: -4px;
    border: 2px solid transparent;
    border-top-color: var(--app-accent);
    border-right-color: color-mix(in oklab, var(--app-accent) 55%, transparent);
    border-radius: 9999px;
    animation: cursor-spin 0.7s linear infinite;
}

@keyframes cursor-spin {
    to {
        rotate: 1turn;
    }
}

/* 禁用形态：外圈加警示描边 */
.adaptive-cursor[data-mode='not-allowed'] .adaptive-cursor-shape {
    width: 1.45rem;
    height: 1.45rem;
    --cursor-fill: color-mix(in oklab, var(--app-danger) 8%, var(--app-bg));
    --cursor-stroke: color-mix(in oklab, var(--app-danger) 76%, transparent);
    border-width: 2px;
    box-shadow: 0 2px 8px
        color-mix(in oklab, var(--app-danger) 22%, transparent);
}

.adaptive-cursor[data-mode='not-allowed'] .adaptive-cursor-shape::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 1rem;
    height: 2px;
    border-radius: 9999px;
    background: var(--app-danger);
    opacity: 0.9;
    transform: translate(-50%, -50%) rotate(-45deg);
}

/* 帮助形态：问号 */
.adaptive-cursor[data-mode='help'] .adaptive-cursor-shape {
    width: 1.35rem;
    height: 1.35rem;
    --cursor-fill: color-mix(in oklab, var(--app-accent) 14%, var(--app-bg));
    --cursor-stroke: color-mix(in oklab, var(--app-accent) 55%, transparent);
}

.adaptive-cursor[data-mode='help'] .adaptive-cursor-shape::before {
    content: '?';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -52%);
    color: var(--app-accent);
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1;
    opacity: 0.95;
}
</style>
