/**
 * Minimal JSON Schema model used by the plugin options form. The kernel emits
 * draft 2020-12 schemas from each plugin's Zod config schema; this module only
 * understands the subset that can be rendered as native controls.
 */

export interface JsonSchema {
    type?: string | string[] | undefined
    title?: string | undefined
    description?: string | undefined
    properties?: Record<string, JsonSchema> | undefined
    required?: string[] | undefined
    additionalProperties?: boolean | JsonSchema | undefined
    items?: JsonSchema | JsonSchema[] | undefined
    enum?: unknown[] | undefined
    const?: unknown
    default?: unknown
    minimum?: number | undefined
    maximum?: number | undefined
    exclusiveMinimum?: number | undefined
    exclusiveMaximum?: number | undefined
    multipleOf?: number | undefined
    minLength?: number | undefined
    maxLength?: number | undefined
    minItems?: number | undefined
    maxItems?: number | undefined
    anyOf?: JsonSchema[] | undefined
    oneOf?: JsonSchema[] | undefined
    allOf?: JsonSchema[] | undefined
    format?: string | undefined
    $ref?: string | undefined
    $defs?: Record<string, JsonSchema> | undefined
    [key: string]: unknown
}

export type SchemaKind =
    | 'object'
    | 'record'
    | 'array'
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'enum'
    | 'json'

export interface SchemaIssue {
    path: string
    message: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function schemaTypes(schema: JsonSchema): string[] {
    const { type } = schema

    if (Array.isArray(type)) return type
    if (typeof type === 'string') return [type]

    if (schema.properties !== undefined) return ['object']

    return []
}

export function enumValues(schema: JsonSchema): unknown[] | null {
    if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
        return [schema.const]
    }

    return Array.isArray(schema.enum) ? schema.enum : null
}

export function schemaKind(schema: JsonSchema): SchemaKind {
    if (schema.$ref !== undefined) return 'json'

    const allowed = enumValues(schema)

    if (allowed !== null) {
        const primitive = allowed.every(
            (value) =>
                value === null ||
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
        )

        return primitive ? 'enum' : 'json'
    }

    if (
        schema.anyOf !== undefined ||
        schema.oneOf !== undefined ||
        schema.allOf !== undefined
    ) {
        return 'json'
    }

    const types = schemaTypes(schema).filter((type) => type !== 'null')

    if (types.length !== 1) return 'json'

    const [type] = types

    if (type === 'object') {
        if (schema.properties !== undefined) {
            return schema.additionalProperties !== undefined &&
                typeof schema.additionalProperties === 'object'
                ? 'json'
                : 'object'
        }

        if (
            schema.additionalProperties !== undefined &&
            typeof schema.additionalProperties === 'object'
        ) {
            return 'record'
        }

        return 'object'
    }

    if (type === 'array') return 'array'
    if (type === 'string') return 'string'
    if (type === 'number' || type === 'integer') return type
    if (type === 'boolean') return 'boolean'

    return 'json'
}

export function canRenderForm(schema: JsonSchema | null): boolean {
    return schema !== null && schemaKind(schema) === 'object'
}

/** Fills `default` values from the schema without materialising optional objects. */
export function applyDefaults(
    schema: JsonSchema | null | undefined,
    value: unknown
): unknown {
    if (schema === null || schema === undefined) return value

    if (value === undefined && schema.default !== undefined) {
        value = cloneJson(schema.default)
    }

    if (schemaKind(schema) !== 'object' || !isRecord(value)) return value

    for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (value[key] === undefined) {
            if (child.default !== undefined) {
                value[key] = cloneJson(child.default)
            }

            continue
        }

        value[key] = applyDefaults(child, value[key])
    }

    return value
}

function matchesType(type: string, value: unknown): boolean {
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return isRecord(value)
    if (type === 'integer') return Number.isInteger(value)
    if (type === 'number')
        return typeof value === 'number' && Number.isFinite(value)
    if (type === 'string') return typeof value === 'string'
    if (type === 'boolean') return typeof value === 'boolean'

    return true
}

function formatPath(path: string): string {
    return path.length > 0 ? path : '<root>'
}

export function validateSchemaValue(
    schema: JsonSchema | null | undefined,
    value: unknown,
    path: string,
    issues: SchemaIssue[]
): void {
    if (schema === null || schema === undefined || value === undefined) return

    if (schema.$ref !== undefined) return

    const types = schemaTypes(schema)

    if (types.length > 0 && !types.some((type) => matchesType(type, value))) {
        issues.push({
            path: formatPath(path),
            message: `类型应为 ${types.join(' | ')}`,
        })

        return
    }

    const allowed = enumValues(schema)

    if (allowed !== null) {
        const serialized = JSON.stringify(value)

        if (!allowed.some((option) => JSON.stringify(option) === serialized)) {
            issues.push({
                path: formatPath(path),
                message: `可选值为 ${allowed.map((option) => JSON.stringify(option)).join(', ')}`,
            })
        }

        return
    }

    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            issues.push({
                path: formatPath(path),
                message: `至少需要 ${schema.minItems} 项`,
            })
        }

        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            issues.push({
                path: formatPath(path),
                message: `最多允许 ${schema.maxItems} 项`,
            })
        }

        if (schema.items !== undefined && !Array.isArray(schema.items)) {
            value.forEach((item, index) => {
                validateSchemaValue(
                    schema.items as JsonSchema,
                    item,
                    `${path}[${index}]`,
                    issues
                )
            })
        }

        return
    }

    if (isRecord(value)) {
        const properties = schema.properties ?? {}

        for (const key of schema.required ?? []) {
            if (value[key] === undefined) {
                issues.push({
                    path: formatPath(path.length > 0 ? `${path}.${key}` : key),
                    message: '必填项',
                })
            }
        }

        for (const [key, child] of Object.entries(value)) {
            const childPath = path.length > 0 ? `${path}.${key}` : key
            const childSchema = properties[key]

            if (childSchema !== undefined) {
                validateSchemaValue(childSchema, child, childPath, issues)
                continue
            }

            if (schema.additionalProperties === false) {
                issues.push({
                    path: childPath,
                    message: 'Schema 中不存在该字段',
                })
            } else if (
                schema.additionalProperties !== undefined &&
                typeof schema.additionalProperties === 'object'
            ) {
                validateSchemaValue(
                    schema.additionalProperties,
                    child,
                    childPath,
                    issues
                )
            }
        }

        return
    }

    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            issues.push({
                path: formatPath(path),
                message: `长度至少为 ${schema.minLength}`,
            })
        }

        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            issues.push({
                path: formatPath(path),
                message: `长度最多为 ${schema.maxLength}`,
            })
        }

        return
    }

    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            issues.push({
                path: formatPath(path),
                message: `不能小于 ${schema.minimum}`,
            })
        }

        if (schema.maximum !== undefined && value > schema.maximum) {
            issues.push({
                path: formatPath(path),
                message: `不能大于 ${schema.maximum}`,
            })
        }

        if (
            schema.multipleOf !== undefined &&
            schema.multipleOf > 0 &&
            Math.abs(
                value / schema.multipleOf -
                    Math.round(value / schema.multipleOf)
            ) >
                Number.EPSILON * 100
        ) {
            issues.push({
                path: formatPath(path),
                message: `必须是 ${schema.multipleOf} 的倍数`,
            })
        }
    }
}
