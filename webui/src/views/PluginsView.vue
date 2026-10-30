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
                    <el-button size="small" @click="load">刷新</el-button>
                </div>
            </template>
            <el-table v-loading="busy" :data="plugins" size="small">
                <el-table-column prop="id" label="ID" width="160" />
                <el-table-column prop="version" label="版本" width="100" />
                <el-table-column prop="description" label="说明" />
                <el-table-column label="状态" width="110">
                    <template #default="{ row }">
                        <el-tag
                            size="small"
                            :type="row.loaded ? 'success' : 'info'"
                        >
                            {{ row.loaded ? '已加载' : '未加载' }}
                        </el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="启用" width="80">
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
                <el-table-column label="操作" width="190">
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
                        <el-button size="small" @click="updateAll">
                            全部更新
                        </el-button>
                    </el-space>
                </div>
            </template>
            <el-table :data="installed" size="small">
                <el-table-column prop="packageName" label="包名" />
                <el-table-column prop="version" label="版本" width="110" />
                <el-table-column label="插件 ID" width="200">
                    <template #default="{ row }">
                        {{ (row.pluginIds ?? []).join(', ') }}
                    </template>
                </el-table-column>
                <el-table-column label="卸载" width="110">
                    <template #default="{ row }">
                        <el-button
                            size="small"
                            type="danger"
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
                    style="width: 320px"
                />
                <el-button type="primary" :loading="busy" @click="install">
                    安装
                </el-button>
            </el-space>
        </el-card>

        <el-drawer
            v-model="configOpen"
            size="620px"
            :title="'插件配置 · ' + currentId"
        >
            <div class="cfg-mode">
                <el-radio-group
                    :model-value="cfgMode"
                    size="small"
                    @change="onModeChange"
                >
                    <el-radio-button value="form">表单</el-radio-button>
                    <el-radio-button value="json">JSON</el-radio-button>
                </el-radio-group>
            </div>

            <PluginOptionsForm ref="formRef" :options="currentOptions" />

            <template #footer>
                <el-button @click="configOpen = false">取消</el-button>
                <el-button type="primary" :loading="busy" @click="saveConfig">
                    保存
                </el-button>
            </template>
        </el-drawer>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { apiGet, apiPost, apiPut, showError } from '@/api'
import PluginOptionsForm from '@/components/PluginOptionsForm.vue'

interface PluginRow {
    id: string
    version: string
    description: string
    enabled: boolean
    loaded: boolean
    options: Record<string, unknown>
}

interface InstalledRow {
    packageName: string
    version: string
    pluginIds?: string[]
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
const busy = ref(false)
const installSpec = ref('')
const configOpen = ref(false)
const cfgMode = ref<'form' | 'json'>('form')
const currentId = ref('')
const currentHash = ref('')
const currentOptions = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof PluginOptionsForm> | null>(null)

const load = async (): Promise<void> => {
    busy.value = true

    try {
        const data = await apiGet<PluginsResponse>('/api/plugins')

        plugins.value = data.plugins
        installed.value = data.installed
        installerEnabled.value = data.installerEnabled
        currentHash.value = data.configHash
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
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
    cfgMode.value = 'form'
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
    if (!installSpec.value) return

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

const updateAll = async (): Promise<void> => {
    busy.value = true

    try {
        await apiPost('/api/plugins/update', {})
        await load()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const removePackage = async (row: InstalledRow): Promise<void> => {
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
    margin-bottom: 16px;
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.cfg-mode {
    margin: 0 0 14px 4px;
}
</style>
