<template>
    <div class="opts-form">
        <template v-if="mode === 'form'">
            <div v-if="rows.length === 0" class="empty">
                该插件暂无配置。点「添加字段」创建第一个，或切到 JSON 直接编辑。
            </div>

            <div v-for="(row, index) in rows" :key="index" class="row">
                <el-input
                    v-model="row.key"
                    class="key"
                    :class="{ dup: isDupKey(index) }"
                    placeholder="字段名"
                />

                <el-select v-model="row.type" class="type">
                    <el-option label="字符串" value="string" />
                    <el-option label="数字" value="number" />
                    <el-option label="开关" value="boolean" />
                    <el-option label="JSON" value="json" />
                    <el-option label="null" value="null" />
                </el-select>

                <div class="value">
                    <el-input
                        v-if="row.type === 'string'"
                        v-model="row.text"
                        placeholder="字符串"
                    />
                    <el-input-number
                        v-else-if="row.type === 'number'"
                        v-model="row.num"
                        :step="1"
                        class="num"
                    />
                    <el-switch
                        v-else-if="row.type === 'boolean'"
                        v-model="row.bool"
                    />
                    <span v-else-if="row.type === 'null'" class="null-mark"
                        >null</span
                    >
                    <el-input
                        v-else
                        v-model="row.raw"
                        type="textarea"
                        :rows="3"
                        spellcheck="false"
                        class="raw"
                        :class="rawInvalid(row) ? 'bad' : ''"
                        placeholder="数组或对象，JSON 格式"
                    />
                </div>

                <el-button
                    class="drop"
                    text
                    :icon="Delete"
                    @click="rows.splice(index, 1)"
                />
            </div>

            <el-button class="add" text :icon="Plus" @click="addField">
                添加字段
            </el-button>
        </template>

        <template v-else>
            <el-input
                v-model="jsonDraft"
                type="textarea"
                :rows="14"
                spellcheck="false"
                class="mono"
                :class="jsonInvalid ? 'bad' : ''"
                placeholder="{}"
            />
            <p class="hint" :class="{ bad: jsonInvalid }">
                {{
                    jsonInvalid
                        ? 'JSON 格式错误，顶层必须是对象或数组'
                        : 'JSON 校验通过——保存时会以这份 JSON 为准'
                }}
            </p>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'

type FieldType = 'string' | 'number' | 'boolean' | 'json' | 'null'

interface FieldRow {
    key: string
    type: FieldType
    text: string
    num: number | undefined
    bool: boolean
    raw: string
}

interface CollectResult {
    ok: boolean
    message?: string
    options?: Record<string, unknown>
}

const props = defineProps<{
    options: Record<string, unknown>
}>()

const mode = ref<'form' | 'json'>('form')
const rows = reactive<FieldRow[]>([])
const jsonDraft = ref('')

const infer = (value: unknown): FieldRow => {
    const row: FieldRow = {
        key: '',
        type: 'json',
        text: '',
        num: undefined,
        bool: false,
        raw: '',
    }

    if (value === null) {
        row.type = 'null'
    } else if (typeof value === 'string') {
        row.type = 'string'
        row.text = value
    } else if (typeof value === 'number') {
        row.type = 'number'
        row.num = value
    } else if (typeof value === 'boolean') {
        row.type = 'boolean'
        row.bool = value
    } else {
        row.type = 'json'
        row.raw = JSON.stringify(value, null, 4)
    }

    return row
}

const rebuild = (): void => {
    rows.length = 0

    for (const [key, value] of Object.entries(props.options ?? {})) {
        const row = infer(value)

        row.key = key
        rows.push(row)
    }

    jsonDraft.value = JSON.stringify(props.options ?? {}, null, 4)
}

watch(() => props.options, rebuild, { immediate: true, deep: false })

const isDupKey = (index: number): boolean =>
    rows.filter((row) => row.key === rows[index]?.key).length > 1

const addField = (): void => {
    let suffix = 1

    while (rows.some((row) => row.key === `新字段${suffix}`)) suffix += 1

    rows.push({
        key: `新字段${suffix}`,
        type: 'string',
        text: '',
        num: undefined,
        bool: false,
        raw: '',
    })
}

const rawInvalid = (row: FieldRow): boolean => {
    if (row.type !== 'json') return false

    try {
        JSON.parse(row.raw)
    } catch {
        return true
    }

    return false
}

const parseJsonBlock = (value: string): unknown => {
    if (value.trim().length === 0) return null

    return JSON.parse(value)
}

const collectRows = (): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    for (const row of rows) {
        if (row.key.trim().length === 0) continue

        result[row.key] = toRowValue(row)
    }

    return result
}

const toRowValue = (row: FieldRow): unknown => {
    if (row.type === 'null') return null
    if (row.type === 'json') return parseJsonBlock(row.raw)
    if (row.type === 'number') return row.num ?? 0
    if (row.type === 'boolean') return row.bool

    return row.text
}

const jsonInvalid = computed((): boolean => {
    try {
        parseJsonBlock(jsonDraft.value)

        const parsed = JSON.parse(jsonDraft.value)

        return !(typeof parsed === 'object' && parsed !== null)
    } catch {
        return true
    }
})

const switchMode = (
    next: 'form' | 'json'
): { ok: boolean; message?: string } => {
    if (next === mode.value) return { ok: true }

    if (next === 'json') {
        for (const row of rows) {
            if (row.type === 'json' && rawInvalid(row)) {
                return {
                    ok: false,
                    message: `字段「${row.key}」的 JSON 有格式错误，无法切到 JSON 模式`,
                }
            }
        }

        jsonDraft.value = JSON.stringify(collectRows(), null, 4)
        mode.value = 'json'

        return { ok: true }
    }

    if (jsonInvalid.value) {
        return {
            ok: false,
            message: 'JSON 里有格式错误，修好了才能切回表单',
        }
    }

    const parsed: Record<string, unknown> = JSON.parse(jsonDraft.value)

    if (Array.isArray(parsed)) {
        return {
            ok: false,
            message: '数组根无法用表单呈现，请继续用 JSON 编辑',
        }
    }

    rows.length = 0

    for (const [key, value] of Object.entries(parsed)) {
        const row = infer(value)

        row.key = key
        rows.push(row)
    }

    mode.value = 'form'

    return { ok: true }
}

const collect = (): CollectResult => {
    if (mode.value === 'json') {
        if (jsonInvalid.value) {
            return { ok: false, message: 'JSON 格式错误' }
        }

        return { ok: true, options: JSON.parse(jsonDraft.value) }
    }

    const keyCounts = new Map<string, number>()

    for (const row of rows) {
        if (row.key.trim().length === 0) {
            return { ok: false, message: '有字段没有名字，请为每个字段命名' }
        }

        keyCounts.set(row.key, (keyCounts.get(row.key) ?? 0) + 1)

        if (row.type === 'json' && rawInvalid(row)) {
            return {
                ok: false,
                message: `字段「${row.key}」的 JSON 有格式错误`,
            }
        }
    }

    const dup = [...keyCounts.entries()].find(([, count]) => count > 1)

    if (dup !== undefined) {
        return { ok: false, message: `字段名「${dup[0]}」重复，请先改名` }
    }

    return { ok: true, options: collectRows() }
}

defineExpose({ collect, mode, switchMode })
</script>

<style scoped>
.opts-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}

.row .key {
    flex: 0 0 148px;
}

.row .type {
    flex: 0 0 96px;
}

.row .value {
    flex: 1;
    min-width: 0;
}

.row .num {
    width: 100%;
}

.row .raw :deep(textarea) {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
}

.row > .drop {
    flex: none;
    color: var(--app-muted);
}

.row > .drop:hover {
    color: var(--app-log-error);
}

.key.dup :deep(.el-input__wrapper) {
    box-shadow:
        0 0 0 1px var(--app-log-error) inset,
        0 0 0 3px color-mix(in oklab, var(--app-log-error) 16%, transparent);
}

.null-mark {
    display: inline-flex;
    padding: 2px 10px;
    border-radius: 7px;
    background: color-mix(in oklab, var(--app-muted) 14%, transparent);
    color: var(--app-muted);
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
}

.add {
    align-self: flex-start;
    color: var(--app-accent);
}

.mono :deep(textarea) {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.65;
}

.mono.bad :deep(textarea:focus) {
    box-shadow:
        0 0 0 1px var(--app-log-error) inset,
        0 0 0 3px color-mix(in oklab, var(--app-log-error) 16%, transparent);
}

.hint {
    margin: 0;
    font-size: 12px;
    color: var(--app-muted);
}

.hint.bad {
    color: var(--app-log-error);
}

.empty {
    padding: 18px 0;
    color: var(--app-muted);
    font-size: 12.5px;
}
</style>
