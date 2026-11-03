import { ref } from 'vue'
import { getAppearance, subscribeAppearance } from '@/appearance'

/**
 * Element Plus parses table column widths with `parseInt`, so rem strings
 * collapse to a few pixels. Track the appearance scale ourselves and hand the
 * table numeric widths that follow the rest of the interface.
 */
const scale = ref(getAppearance().uiScale ?? 1)

subscribeAppearance(() => {
    scale.value = getAppearance().uiScale ?? 1
})

export function scaledPx(value: number): number {
    return Math.round(value * scale.value)
}
