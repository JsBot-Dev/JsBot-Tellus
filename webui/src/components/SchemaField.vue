<template>
    <div
        v-if="kind === 'object'"
        class="schema-object"
        :class="{ nested: depth > 0 }"
    >
        <div v-if="depth > 0" class="object-head">
            <span class="object-label">
                {{ label }}
                <span v-if="required" class="req">*</span>
            </span>
            <span v-if="schema.description" class="desc">
                {{ schema.description }}
            </span>
        </div>

        <div class="object-body">
            <SchemaField
                v-for="(child, key) in properties"
                :key="key"
                :name="String(key)"
                :path="childPath(String(key))"
                :schema="child"
                :required="requiredSet.has(String(key))"
                :model-value="objectValue[String(key)]"
                :depth="depth + 1"
                :report-invalid="reportInvalid"
                @update:model-value="
                    (value: unknown) => setChild(String(key), value)
                "
            />
            <p v-if="Object.keys(properties).length === 0" class="empty">
                没有可配置项
            </p>
        </div>
    </div>

    <div v-else class="schema-field">
        <label class="field-label">
            <span>
                {{ label }}
                <span v-if="required" class="req">*</span>
            </span>
            <span class="field-kind">{{ kindLabel }}</span>
        </label>

        <el-switch
            v-if="kind === 'boolean'"
            :model-value="modelValue === true"
            @update:model-value="
                (value: string | number | boolean) => emitValue(Boolean(value))
            "
        />

        <el-select
            v-else-if="kind === 'enum'"
            :model-value="modelValue"
            class="enum-select"
            @update:model-value="emitValue"
        >
            <el-option
                v-for="(option, index) in enumOptions"
                :key="index"
                :label="optionLabel(option)"
                :value="option"
            />
        </el-select>

        <el-input-number
            v-else-if="kind === 'number' || kind === 'integer'"
            :model-value="numberValue"
            :min="schema.minimum"
            :max="schema.maximum"
            :step="numberStep"
            controls-position="right"
            class="number-input"
            @update:model-value="
                (value: number | undefined | null) =>
                    emitValue(value === null ? undefined : value)
            "
        />

        <el-input
            v-else-if="kind === 'string'"
            :model-value="stringValue"
            :maxlength="schema.maxLength"
            @update:model-value="(value: string) => emitValue(value)"
        />

        <el-input
            v-else
            :model-value="jsonDraft"
            type="textarea"
            :rows="4"
            spellcheck="false"
            class="mono"
            :class="{ bad: jsonError }"
            :placeholder="jsonPlaceholder"
            @update:model-value="onJsonInput"
        />

        <p v-if="schema.description" class="desc">{{ schema.description }}</p>
        <p v-if="jsonError" class="field-error">{{ jsonError }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
    enumValues,
    isRecord,
    schemaKind,
    type JsonSchema,
    type SchemaKind,
} from '@/components/json-schema'

const props = withDefaults(
    defineProps<{
        schema: JsonSchema
        name: string
        path: string
        required?: boolean
        modelValue?: unknown
        depth?: number
        reportInvalid?: (path: string, message: string | null) => void
    }>(),
    {
        required: false,
        modelValue: undefined,
        depth: 0,
        reportInvalid: undefined,
    }
)

const emit = defineEmits<{
    'update:modelValue': [value: unknown]
}>()

const kind = computed((): SchemaKind => schemaKind(props.schema))
const properties = computed(() => props.schema.properties ?? {})
const requiredSet = computed(() => new Set(props.schema.required ?? []))
const label = computed(() => props.schema.title ?? props.name)

const kindLabels: Record<SchemaKind, string> = {
    object: '对象',
    record: '键值对',
    array: '数组',
    string: '字符串',
    number: '数字',
    integer: '整数',
    boolean: '开关',
    enum: '枚举',
    json: 'JSON',
}

const kindLabel = computed(() => kindLabels[kind.value])

const objectValue = computed(() =>
    isRecord(props.modelValue) ? props.modelValue : {}
)

const childPath = (key: string): string =>
    props.path.length > 0 ? `${props.path}.${key}` : key

const setChild = (key: string, value: unknown): void => {
    const next = { ...objectValue.value }

    if (value === undefined) {
        delete next[key]
    } else {
        next[key] = value
    }

    emitValue(next)
}

const emitValue = (value: unknown): void => {
    emit('update:modelValue', value)
}

const enumOptions = computed(() => enumValues(props.schema) ?? [])
const optionLabel = (value: unknown): string =>
    value === null
        ? 'null'
        : typeof value === 'string'
          ? value
          : JSON.stringify(value)

const numberValue = computed(() =>
    typeof props.modelValue === 'number' ? props.modelValue : undefined
)
const numberStep = computed(() => {
    if (props.schema.multipleOf !== undefined) return props.schema.multipleOf

    return kind.value === 'integer' ? 1 : 0.1
})

const stringValue = computed(() => {
    if (typeof props.modelValue === 'string') return props.modelValue
    if (props.modelValue === null || props.modelValue === undefined) return ''

    return String(props.modelValue)
})

const jsonPlaceholder = computed(() => {
    if (kind.value === 'array') return '[]'
    if (kind.value === 'record') return '{}'
    return 'JSON 值'
})

const jsonLike = computed(
    () =>
        kind.value === 'json' ||
        kind.value === 'array' ||
        kind.value === 'record'
)

const formatJson = (value: unknown): string => {
    if (value === undefined) return ''

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return ''
    }
}

const jsonDraft = ref('')
const jsonError = ref('')
let lastSynced = ''

const syncJson = (value: unknown): void => {
    const text = formatJson(value)

    if (text === lastSynced) return

    lastSynced = text
    jsonDraft.value = text
    jsonError.value = ''
}

watch(
    [() => props.modelValue, () => props.schema],
    () => {
        if (jsonLike.value) syncJson(props.modelValue)
    },
    { immediate: true }
)

const onJsonInput = (raw: string): void => {
    if (raw.trim().length === 0) {
        jsonError.value = ''
        lastSynced = ''
        emitValue(undefined)

        return
    }

    try {
        const parsed: unknown = JSON.parse(raw)

        jsonError.value = ''
        lastSynced = formatJson(parsed)
        emitValue(parsed)
    } catch {
        jsonError.value = 'JSON 格式错误'
    }
}

watch(
    [jsonError, () => props.path, jsonLike],
    () => {
        if (!jsonLike.value) {
            props.reportInvalid?.(props.path, null)
            return
        }

        props.reportInvalid?.(props.path, jsonError.value || null)
    },
    { immediate: true }
)

onUnmounted(() => {
    props.reportInvalid?.(props.path, null)
})
</script>

<style scoped>
.schema-object {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.schema-object.nested {
    padding-left: 0.75rem;
    border-left: 2px solid var(--app-border);
}

.object-head {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
}

.object-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--app-text);
}

.object-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.schema-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.field-label {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    justify-content: space-between;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--app-text);
}

.field-kind {
    flex: none;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--app-muted);
}

.req {
    margin-left: 0.125rem;
    color: var(--app-danger);
}

.desc {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--app-muted);
}

.field-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--app-log-error);
}

.enum-select,
.number-input {
    width: 100%;
}

.mono :deep(textarea) {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.6;
}

.mono.bad :deep(textarea:focus) {
    box-shadow:
        0 0 0 1px var(--app-log-error) inset,
        0 0 0 3px color-mix(in oklab, var(--app-log-error) 16%, transparent);
}

.empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--app-muted);
}
</style>
