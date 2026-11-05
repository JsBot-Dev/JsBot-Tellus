<template>
    <div>
        <el-alert
            v-if="!installerEnabled"
            title="插件安装器未启用（installer.enabled = false）"
            type="info"
            :closable="false"
            class="block"
        />

        <el-card class="block">
            <template #header>
                <div class="card-header">
                    <span>已加载插件</span>
                    <el-button
                        size="small"
                        :loading="loading"
                        :disabled="actionBusy"
                        @click="load"
                    >
                        刷新
                    </el-button>
                </div>
            </template>
            <el-table v-loading="loading || busy" :data="plugins" size="small">
                <el-table-column prop="id" label="ID" :width="scaledPx(260)" />
                <el-table-column
                    prop="version"
                    label="版本"
                    :width="scaledPx(100)"
                />
                <el-table-column
                    prop="description"
                    label="说明"
                    :min-width="scaledPx(260)"
                />
                <el-table-column label="状态" :width="scaledPx(110)">
                    <template #default="{ row }">
                        <el-tag
                            size="small"
                            :type="row.loaded ? 'success' : 'info'"
                        >
                            {{ row.loaded ? '已加载' : '未加载' }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="群限制" :width="scaledPx(110)">
                    <template #default="{ row }">
                        <el-tag
                            size="small"
                            :type="groupSummary(row).type"
                            :title="groupSummary(row).detail"
                        >
                            {{ groupSummary(row).text }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="启用" :width="scaledPx(80)">
                    <template #default="{ row }">
                        <el-switch
                            :model-value="row.enabled"
                            @change="
                                (value: string | number | boolean) =>
                                    togglePlugin(row, Boolean(value))
                            "
                        />
                    </template>
                </el-table-column>
                <el-table-column label="操作" :width="scaledPx(190)">
                    <template #default="{ row }">
                        <el-button size="small" @click="openConfig(row)">
                            配置
                        </el-button>
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-card>
            <template #header>
                <div class="card-header">
                    <span>已安装 npm 包</span>
                    <el-space>
                        <el-button
                            size="small"
                            :loading="checkingAll"
                            :disabled="actionBusy || !installerEnabled"
                            @click="checkAll"
                        >
                            检查更新
                        </el-button>
                        <el-button
                            size="small"
                            :loading="updatingAll"
                            :disabled="actionBusy || !installerEnabled"
                            @click="updateAll"
                        >
                            全部更新
                        </el-button>
                    </el-space>
                </div>
            </template>
            <el-table v-loading="loading" :data="installed" size="small">
                <el-table-column
                    prop="packageName"
                    label="包名"
                    :min-width="scaledPx(260)"
                />
                <el-table-column
                    prop="version"
                    label="版本"
                    :width="scaledPx(110)"
                />
                <el-table-column label="最新版本" :min-width="scaledPx(190)">
                    <template #default="{ row }">
                        <el-tooltip
                            v-if="updates[row.packageName]?.error"
                            :content="updates[row.packageName]?.error ?? ''"
                            placement="top"
                        >
                            <el-tag size="small" type="danger">
                                检查失败
                            </el-tag>
                        </el-tooltip>
                        <el-tag
                            v-else-if="
                                updates[row.packageName]?.updateAvailable
                            "
                            size="small"
                            type="warning"
                        >
                            可更新至
                            {{
                                updates[row.packageName]?.latestVersion ??
                                '未知版本'
                            }}
                        </el-tag>
                        <el-tag
                            v-else-if="updates[row.packageName]"
                            size="small"
                            type="success"
                        >
                            已是最新
                        </el-tag>
                        <span v-else>—</span>
                    </template>
                </el-table-column>
                <el-table-column label="插件 ID" :width="scaledPx(200)">
                    <template #default="{ row }">
                        {{ (row.pluginIds ?? []).join(', ') }}
                    </template>
                </el-table-column>
                <el-table-column label="操作" :width="scaledPx(240)">
                    <template #default="{ row }">
                        <el-button
                            size="small"
                            :loading="checking === row.packageName"
                            :disabled="actionBusy || !installerEnabled"
                            @click="checkOne(row)"
                        >
                            检查
                        </el-button>
                        <el-button
                            size="small"
                            :loading="updating === row.packageName"
                            :disabled="actionBusy || !installerEnabled"
                            @click="updateOne(row)"
                        >
                            更新
                        </el-button>
                        <el-button
                            size="small"
                            type="danger"
                            :disabled="actionBusy || !installerEnabled"
                            @click="removePackage(row)"
                        >
                            卸载
                        </el-button>
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-card class="block">
            <el-space>
                <el-input
                    v-model="installSpec"
                    placeholder="包名，如 @scope/jsbot-plugin-xxx"
                    style="width: 20rem"
                />
                <el-button
                    type="primary"
                    :loading="busy"
                    :disabled="actionBusy || !installerEnabled"
                    @click="install"
                >
                    安装
                </el-button>
            </el-space>
        </el-card>

        <el-dialog
            v-model="configOpen"
            width="min(94vw, 38.75rem)"
            :title="'插件配置 · ' + currentId"
            align-center
            :append-to-body="true"
            class="app-dialog"
        >
            <div v-if="canUseForm" class="cfg-mode">
                <el-radio-group
                    :model-value="cfgMode"
                    size="small"
                    @change="onModeChange"
                >
                    <el-radio-button value="form">表单</el-radio-button>
                    <el-radio-button value="json">JSON</el-radio-button>
                </el-radio-group>
            </div>

            <el-alert
                v-else
                type="info"
                :closable="false"
                show-icon
                class="cfg-note"
                title="该插件的 Schema 无法转换为表单，请直接编辑 JSON；保存时仍会严格校验。"
            />

            <section class="envelope">
                <div class="envelope-head">
                    <h4>群限制</h4>
                    <span class="envelope-hint">
                        allow / deny 不能同时非空；留空表示不限制
                    </span>
                </div>

                <div class="group-grid">
                    <div class="group-field">
                        <span class="group-label">
                            仅允许这些群 <code>allow</code>
                        </span>
                        <el-input
                            v-model="allowText"
                            type="textarea"
                            :rows="2"
                            spellcheck="false"
                            placeholder="群号，逗号或换行分隔"
                        />
                    </div>

                    <div class="group-field">
                        <span class="group-label">
                            禁止这些群 <code>deny</code>
                        </span>
                        <el-input
                            v-model="denyText"
                            type="textarea"
                            :rows="2"
                            spellcheck="false"
                            placeholder="群号，逗号或换行分隔"
                        />
                    </div>
                </div>

                <div class="private-row">
                    <div>
                        <span class="group-label">允许私聊</span>
                        <p class="envelope-hint">关闭后该插件只处理群消息</p>
                    </div>
                    <el-switch v-model="currentPrivate" />
                </div>

                <p v-if="groupsError" class="group-error">
                    {{ groupsError }}
                </p>
            </section>

            <PluginOptionsForm
                ref="formRef"
                :options="currentOptions"
                :schema="currentSchema"
            />

            <template #footer>
                <el-button @click="configOpen = false">取消</el-button>
                <el-button type="primary" :loading="busy" @click="saveConfig">
                    保存
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { apiGet, apiPost, apiPut, showError } from '@/api'
import PluginOptionsForm from '@/components/PluginOptionsForm.vue'
import { canRenderForm, type JsonSchema } from '@/components/json-schema'
import { scaledPx } from '@/use-ui-scale'

interface PluginGroups {
    allow?: number[]
    deny?: number[]
}

interface PluginEnvelope {
    enabled?: boolean
    private?: boolean
    groups?: PluginGroups
    [key: string]: unknown
}

interface PluginRow {
    id: string
    version: string
    description: string
    enabled: boolean
    loaded: boolean
    config: PluginEnvelope
    options: Record<string, unknown>
    configSchema: JsonSchema | null
}

interface InstalledRow {
    packageName: string
    version: string
    pluginIds?: string[]
}

interface PluginUpdateInfo {
    packageName: string
    currentVersion: string
    latestVersion: string | null
    updateAvailable: boolean
    error: string | null
}

interface PluginCheckUpdatesResponse {
    packages: PluginUpdateInfo[]
}

interface PluginUpdateResponse {
    updated: Array<{
        packageName: string
        version: string
        warnings: string[]
    }>
    failed: Array<{ packageName: string; message: string }>
}

interface PluginsResponse {
    plugins: PluginRow[]
    installed: InstalledRow[]
    installerEnabled: boolean
    configHash: string
}

const plugins = ref<PluginRow[]>([])
const installed = ref<InstalledRow[]>([])
const installerEnabled = ref(true)
const loading = ref(false)
const busy = ref(false)
const createUpdateMap = (): Record<string, PluginUpdateInfo> =>
    Object.create(null) as Record<string, PluginUpdateInfo>
const updates = ref(createUpdateMap())
const checking = ref<string | null>(null)
const checkingAll = ref(false)
const updating = ref<string | null>(null)
const updatingAll = ref(false)
const installSpec = ref('')
const configOpen = ref(false)
const cfgMode = ref<'form' | 'json'>('form')
const currentId = ref('')
const currentHash = ref('')
const currentOptions = ref<Record<string, unknown>>({})
const currentSchema = ref<JsonSchema | null>(null)
const currentPrivate = ref(true)
const allowText = ref('')
const denyText = ref('')
const formRef = ref<InstanceType<typeof PluginOptionsForm> | null>(null)
const canUseForm = computed(() => canRenderForm(currentSchema.value))
const actionBusy = computed(
    () =>
        loading.value ||
        busy.value ||
        checking.value !== null ||
        checkingAll.value ||
        updating.value !== null ||
        updatingAll.value
)

type TagType = 'success' | 'warning' | 'info'

const groupSummary = (
    row: PluginRow
): {
    text: string
    type: TagType
    detail: string
} => {
    const allow = row.config?.groups?.allow ?? []
    const deny = row.config?.groups?.deny ?? []

    if (allow.length > 0) {
        return {
            text: `允许 ${allow.length} 群`,
            type: 'success',
            detail: `allow: ${allow.join(', ')}`,
        }
    }

    if (deny.length > 0) {
        return {
            text: `禁止 ${deny.length} 群`,
            type: 'warning',
            detail: `deny: ${deny.join(', ')}`,
        }
    }

    return { text: '不限', type: 'info', detail: '未设置 allow / deny' }
}

const parseGroupIds = (
    raw: string,
    label: string
): { ids: number[]; error: string | null } => {
    const ids: number[] = []

    for (const token of raw.split(/[\s,，;；]+/u)) {
        if (token.length === 0) continue

        if (!/^[0-9]+$/u.test(token)) {
            return { ids, error: `${label}中包含无效群号：${token}` }
        }

        const id = Number(token)

        if (!Number.isSafeInteger(id) || id <= 0) {
            return { ids, error: `${label}中的群号必须是正整数：${token}` }
        }

        if (!ids.includes(id)) ids.push(id)
    }

    return { ids, error: null }
}

const parsedGroups = computed(() => {
    const allow = parseGroupIds(allowText.value, '允许群')
    const deny = parseGroupIds(denyText.value, '禁止群')

    if (allow.error !== null) {
        return { allow: allow.ids, deny: [], error: allow.error }
    }

    if (deny.error !== null) {
        return { allow: allow.ids, deny: deny.ids, error: deny.error }
    }

    if (allow.ids.length > 0 && deny.ids.length > 0) {
        return {
            allow: allow.ids,
            deny: deny.ids,
            error: '允许群和禁止群不能同时填写，请清空其中一个',
        }
    }

    return { allow: allow.ids, deny: deny.ids, error: null }
})

const groupsError = computed(() => parsedGroups.value.error ?? '')

const load = async (): Promise<void> => {
    if (loading.value) return

    loading.value = true

    try {
        const data = await apiGet<PluginsResponse>('/api/plugins')

        plugins.value = data.plugins
        installed.value = data.installed
        installerEnabled.value = data.installerEnabled
        currentHash.value = data.configHash

        const validUpdates = createUpdateMap()

        for (const [name, info] of Object.entries(updates.value)) {
            const row = data.installed.find((item) => item.packageName === name)

            if (row !== undefined && row.version === info.currentVersion) {
                validUpdates[name] = info
            }
        }

        updates.value = validUpdates
    } catch (error) {
        showError(error)
    } finally {
        loading.value = false
    }
}

const togglePlugin = async (
    row: PluginRow,
    value: string | number | boolean
): Promise<void> => {
    try {
        await apiPut(`/api/plugins/${encodeURIComponent(row.id)}/config`, {
            enabled: Boolean(value),
        })
        await load()
    } catch (error) {
        showError(error)
    }
}

const openConfig = (row: PluginRow): void => {
    currentId.value = row.id
    currentOptions.value = row.options ?? {}
    currentSchema.value = row.configSchema ?? null
    currentPrivate.value = row.config?.private ?? true
    allowText.value = (row.config?.groups?.allow ?? []).join(', ')
    denyText.value = (row.config?.groups?.deny ?? []).join(', ')
    cfgMode.value = canRenderForm(row.configSchema ?? null) ? 'form' : 'json'
    configOpen.value = true
}

const onModeChange = (value: string | number | boolean): void => {
    const form = formRef.value

    if (form === null) return

    const next = value === 'json' ? 'json' : 'form'
    const result = form.switchMode(next)

    if (result.ok) {
        cfgMode.value = next
    } else {
        ElMessage.warning(result.message ?? '无法切换模式')
    }
}

const saveConfig = async (): Promise<void> => {
    if (busy.value) return

    const groups = parsedGroups.value

    if (groups.error !== null) {
        ElMessage.warning(groups.error)

        return
    }

    const form = formRef.value

    if (form === null) return

    const result = form.collect()

    if (!result.ok) {
        ElMessage.warning(result.message ?? '配置未能通过校验')

        return
    }

    busy.value = true

    try {
        await apiPut(
            `/api/plugins/${encodeURIComponent(currentId.value)}/config`,
            {
                options: result.options ?? {},
                private: currentPrivate.value,
                groups: { allow: groups.allow, deny: groups.deny },
                baseHash: currentHash.value,
            }
        )
        configOpen.value = false
        ElMessage.success('配置已保存')
        await load()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const install = async (): Promise<void> => {
    if (!installSpec.value || actionBusy.value) return

    busy.value = true

    try {
        await apiPost('/api/plugins/install', { spec: installSpec.value })
        ElMessage.success('安装完成，请自行重启运行时使其生效')
        installSpec.value = ''
        await load()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const mergeUpdates = (packages: PluginUpdateInfo[]): void => {
    if (packages.length === 0) return

    const next = Object.assign(createUpdateMap(), updates.value)

    for (const info of packages) next[info.packageName] = info

    updates.value = next
}

const applyUpdateResult = (result: PluginUpdateResponse): void => {
    if (result.updated.length > 0) {
        const next = Object.assign(createUpdateMap(), updates.value)

        for (const item of result.updated) {
            next[item.packageName] = {
                packageName: item.packageName,
                currentVersion: item.version,
                latestVersion: item.version,
                updateAvailable: false,
                error: null,
            }
        }

        updates.value = next
        ElMessage.success(
            `已更新 ${result.updated.length} 个包，请自行重启运行时使其生效`
        )
    }

    for (const item of result.updated) {
        for (const warning of item.warnings) {
            ElMessage.warning(`${item.packageName}：${warning}`)
        }
    }

    for (const failure of result.failed) {
        ElMessage.error(`${failure.packageName}：${failure.message}`)
    }
}

const checkOne = async (row: InstalledRow): Promise<void> => {
    if (actionBusy.value) return

    checking.value = row.packageName

    try {
        const data = await apiPost<PluginCheckUpdatesResponse>(
            '/api/plugins/check-updates',
            { target: row.packageName }
        )

        mergeUpdates(data.packages)
    } catch (error) {
        showError(error)
    } finally {
        checking.value = null
    }
}

const checkAll = async (): Promise<void> => {
    if (actionBusy.value) return

    checkingAll.value = true

    try {
        const data = await apiPost<PluginCheckUpdatesResponse>(
            '/api/plugins/check-updates',
            {}
        )

        mergeUpdates(data.packages)
    } catch (error) {
        showError(error)
    } finally {
        checkingAll.value = false
    }
}

const updateOne = async (row: InstalledRow): Promise<void> => {
    if (actionBusy.value) return

    updating.value = row.packageName

    try {
        const result = await apiPost<PluginUpdateResponse>(
            '/api/plugins/update',
            { target: row.packageName }
        )

        applyUpdateResult(result)
        await load()
    } catch (error) {
        showError(error)
    } finally {
        updating.value = null
    }
}

const updateAll = async (): Promise<void> => {
    if (actionBusy.value) return

    updatingAll.value = true

    try {
        const result = await apiPost<PluginUpdateResponse>(
            '/api/plugins/update',
            {}
        )

        applyUpdateResult(result)
        await load()
    } catch (error) {
        showError(error)
    } finally {
        updatingAll.value = false
    }
}

const removePackage = async (row: InstalledRow): Promise<void> => {
    if (actionBusy.value) return

    busy.value = true

    try {
        await apiPost('/api/plugins/remove', { target: row.packageName })
        await load()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

onMounted(() => void load())
</script>

<style scoped>
.block {
    margin-bottom: 1rem;
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.cfg-mode {
    margin: 0 0 0.875rem 0.25rem;
}

.cfg-note {
    margin-bottom: 0.875rem;
}

.envelope {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 0.875rem;
    margin-bottom: 0.875rem;
    border-bottom: 1px solid var(--app-border);
}

.envelope-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: baseline;
    justify-content: space-between;
}

.envelope-head h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--app-text);
}

.group-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
}

.group-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.group-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--app-text);
}

.group-label code {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--app-muted);
}

.envelope-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--app-muted);
}

.private-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
}

.private-row p {
    margin: 0.125rem 0 0;
}

.group-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--app-log-error);
}
</style>
