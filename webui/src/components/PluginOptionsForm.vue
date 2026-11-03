<template>
    <div class="opts-form">
        <template v-if="mode === 'form' && canUseForm">
            <p v-if="fieldEntries.length === 0" class="empty">
                该插件的 Schema 没有声明可配置字段。
            </p>

            <SchemaField
                v-for="[key, field] in fieldEntries"
                :key="key"
                :name="key"
                :path="key"
                :schema="field"
                :required="requiredSet.has(key)"
                :model-value="draft[key]"
                :depth="1"
                :report-invalid="reportInvalid"
                @update:model-value="(value: unknown) => setValue(key, value)"
            />

            <el-alert
                v-if="unknownKeys.length > 0"
                type="warning"
                :closable="false"
                show-icon
                class="notice"
            >
                <template #title>
                    Schema 之外的字段已忽略：{{ unknownKeys.join('、') }}
                </template>
            </el-alert>

            <el-alert
                v-if="issues.length > 0"
                type="error"
                :closable="false"
                show-icon
                class="notice"
                title="配置未通过 Schema 校验"
            >
                <ul class="issue-list">
                    <li v-for="(issue, index) in issues" :key="index">
                        {{ issue.path }}：{{ issue.message }}
                    </li>
                </ul>
            </el-alert>
        </template>

        <template v-else>
            <el-input
                v-model="jsonDraft"
                type="textarea"
                :rows="14"
                spellcheck="false"
                class="mono"
                :class="jsonError ? 'bad' : ''"
                placeholder="{}"
                @update:model-value="onJsonInput"
            />

            <p class="hint" :class="{ bad: jsonError }">
                {{ hint }}
            </p>

            <el-alert
                v-if="issues.length > 0"
                type="error"
                :closable="false"
                show-icon
                title="配置未通过 Schema 校验"
            >
                <ul class="issue-list">
                    <li v-for="(issue, index) in issues" :key="index">
                        {{ issue.path }}：{{ issue.message }}
                    </li>
                </ul>
            </el-alert>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import SchemaField from '@/components/SchemaField.vue'
import {
    applyDefaults,
    canRenderForm,
    isRecord,
    validateSchemaValue,
    type JsonSchema,
    type SchemaIssue,
} from '@/components/json-schema'

interface CollectResult {
    ok: boolean
    message?: string
    options?: Record<string, unknown>
}

const props = defineProps<{
    options: Record<string, unknown>
    schema: JsonSchema | null
}>()

const mode = ref<'form' | 'json'>('form')
const canUseForm = computed(() => canRenderForm(props.schema))
const fields = computed(() => props.schema?.properties ?? {})
const fieldEntries = computed(() => Object.entries(fields.value))
const requiredSet = computed(() => new Set(props.schema?.required ?? []))

const draft = reactive<Record<string, unknown>>({})
const unknownKeys = ref<string[]>([])
const issues = ref<SchemaIssue[]>([])
const invalidFields = reactive(new Map<string, string>())

const jsonDraft = ref('')
const jsonError = ref(false)

const reportInvalid = (path: string, message: string | null): void => {
    if (message === null) {
        invalidFields.delete(path)
    } else {
        invalidFields.set(path, message)
    }
}

const clearDraft = (): void => {
    for (const key of Object.keys(draft)) delete draft[key]
}

const splitOptions = (
    source: Record<string, unknown>
): { known: Record<string, unknown>; unknown: string[] } => {
    if (props.schema === null) {
        return { known: { ...source }, unknown: [] }
    }

    const allowed = new Set(Object.keys(fields.value))
    const known: Record<string, unknown> = {}
    const unknown: string[] = []

    for (const [key, value] of Object.entries(source)) {
        if (allowed.has(key)) {
            known[key] = value
        } else {
            unknown.push(key)
        }
    }

    return { known, unknown }
}

const fillDraft = (value: unknown): void => {
    clearDraft()

    if (!isRecord(value)) return

    for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) draft[key] = child
    }
}

const reset = (): void => {
    invalidFields.clear()
    issues.value = []
    jsonError.value = false

    const source = props.options ?? {}
    const { known, unknown } = splitOptions(source)

    unknownKeys.value = unknown
    jsonDraft.value = JSON.stringify(source, null, 4)

    if (props.schema === null) {
        fillDraft(known)
        mode.value = 'json'

        return
    }

    fillDraft(applyDefaults(props.schema, known))
    mode.value = canUseForm.value ? 'form' : 'json'
}

watch([() => props.options, () => props.schema], reset, { immediate: true })

const setValue = (key: string, value: unknown): void => {
    if (value === undefined) {
        delete draft[key]
    } else {
        draft[key] = value
    }

    issues.value = []
}

const plainDraft = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(draft)) as Record<string, unknown>

const formatIssues = (list: SchemaIssue[]): string =>
    list.map((issue) => `${issue.path}：${issue.message}`).join('；')

const onJsonInput = (raw: string): void => {
    jsonError.value = false
    issues.value = []

    if (raw.trim().length === 0) return

    try {
        JSON.parse(raw)
    } catch {
        jsonError.value = true
    }
}

const hint = computed(() => {
    if (jsonError.value) return 'JSON 格式错误，请先修复再保存。'
    if (props.schema === null) {
        return '该插件的 Schema 无法转为表单，只能编辑 JSON。保存时后端仍会严格校验。'
    }

    return 'JSON 格式正确。保存时后端会按插件 Schema 严格校验。'
})

const collect = (): CollectResult => {
    if (mode.value === 'json') {
        if (jsonError.value) {
            return { ok: false, message: 'JSON 格式错误' }
        }

        let parsed: unknown = {}

        try {
            parsed =
                jsonDraft.value.trim().length > 0
                    ? JSON.parse(jsonDraft.value)
                    : {}
        } catch {
            return { ok: false, message: 'JSON 格式错误' }
        }

        if (!isRecord(parsed)) {
            return { ok: false, message: '顶层配置必须是一个对象' }
        }

        const found: SchemaIssue[] = []
        validateSchemaValue(props.schema, parsed, '', found)
        issues.value = found

        return found.length > 0
            ? { ok: false, message: formatIssues(found) }
            : { ok: true, options: parsed }
    }

    if (invalidFields.size > 0) {
        return {
            ok: false,
            message: `以下字段的 JSON 有格式错误：${[...invalidFields.keys()].join('、')}`,
        }
    }

    const found: SchemaIssue[] = []
    validateSchemaValue(props.schema, draft, '', found)
    issues.value = found

    return found.length > 0
        ? { ok: false, message: formatIssues(found) }
        : { ok: true, options: plainDraft() }
}

const switchMode = (
    next: 'form' | 'json'
): { ok: boolean; message?: string } => {
    if (next === mode.value) return { ok: true }

    if (next === 'json') {
        if (invalidFields.size > 0) {
            return {
                ok: false,
                message: `以下字段的 JSON 有格式错误：${[...invalidFields.keys()].join('、')}`,
            }
        }

        jsonDraft.value = JSON.stringify(plainDraft(), null, 4)
        jsonError.value = false
        issues.value = []
        mode.value = 'json'

        return { ok: true }
    }

    if (!canUseForm.value) {
        return {
            ok: false,
            message: '该插件的 Schema 无法用表单呈现，请继续使用 JSON',
        }
    }

    if (jsonError.value) {
        return { ok: false, message: 'JSON 里有格式错误，修好了才能切回表单' }
    }

    let parsed: unknown = {}

    try {
        parsed =
            jsonDraft.value.trim().length > 0 ? JSON.parse(jsonDraft.value) : {}
    } catch {
        return { ok: false, message: 'JSON 里有格式错误，修好了才能切回表单' }
    }

    if (!isRecord(parsed)) {
        return { ok: false, message: '顶层配置必须是一个对象，无法用表单呈现' }
    }

    const { known, unknown } = splitOptions(parsed)

    unknownKeys.value = unknown
    fillDraft(applyDefaults(props.schema, known))
    issues.value = []
    invalidFields.clear()
    mode.value = 'form'

    return { ok: true }
}

defineExpose({ collect, mode, switchMode })
</script>

<style scoped>
.opts-form {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
}

.notice {
    margin-top: 0.25rem;
}

.issue-list {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    font-size: 0.75rem;
    line-height: 1.6;
}

.mono :deep(textarea) {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.65;
}

.mono.bad :deep(textarea:focus) {
    box-shadow:
        0 0 0 1px var(--app-log-error) inset,
        0 0 0 3px color-mix(in oklab, var(--app-log-error) 16%, transparent);
}

.hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--app-muted);
}

.hint.bad {
    color: var(--app-log-error);
}

.empty {
    padding: 0.5rem 0;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--app-muted);
}
</style>
