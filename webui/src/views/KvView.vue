<template>
    <div>
        <el-card class="block">
            <el-select
                v-model="pluginId"
                placeholder="选择插件"
                style="width: 240px"
                @change="load"
            >
                <el-option
                    v-for="row in plugins"
                    :key="row.pluginId"
                    :label="`${row.pluginId} (${row.count})`"
                    :value="row.pluginId"
                />
            </el-select>
        </el-card>

        <el-card v-if="pluginId">
            <el-space class="block">
                <el-input
                    v-model="prefix"
                    placeholder="key 前缀过滤"
                    style="width: 200px"
                    @keyup.enter="load"
                />
                <el-button @click="load">过滤</el-button>
                <el-button type="primary" @click="startEdit">新增 KV</el-button>
            </el-space>

            <el-table v-loading="busy" :data="items" size="small">
                <el-table-column prop="key" label="Key" show-overflow-tooltip />
                <el-table-column label="Value" show-overflow-tooltip>
                    <template #default="{ row }">
                        {{ display(row.value) }}
                    </template>
                </el-table-column>
                <el-table-column label="更新时间" width="180">
                    <template #default="{ row }">
                        {{ formatTime(row.updatedAt) }}
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="150">
                    <template #default="{ row }">
                        <el-button size="small" @click="edit(row)"
                            >编辑</el-button
                        >
                        <el-button
                            size="small"
                            type="danger"
                            @click="remove(row)"
                            >删除</el-button
                        >
                    </template>
                </el-table-column>
            </el-table>
            <el-pagination
                class="pager"
                layout="total, prev, pager, next"
                :total="total"
                :page-size="pageSize"
                :current-page="page"
                @current-change="onPage"
            />
        </el-card>

        <el-dialog v-model="editor" title="KV 编辑" width="560px">
            <el-form label-width="80px">
                <el-form-item label="key">
                    <el-input
                        v-model="editKey"
                        :disabled="editMode === 'update'"
                    />
                </el-form-item>
                <el-form-item label="value (JSON)">
                    <el-input
                        v-model="editValue"
                        type="textarea"
                        :rows="6"
                        spellcheck="false"
                    />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="editor = false">取消</el-button>
                <el-button type="primary" @click="save">保存</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { apiDelete, apiGet, apiPut, formatTime, showError } from '@/api'

interface KvPlugin {
    pluginId: string
    count: number
}

interface KvItem {
    pluginId: string
    key: string
    value: unknown
    updatedAt: number
}

const plugins = ref<KvPlugin[]>([])
const pluginId = ref('')
const prefix = ref('')
const items = ref<KvItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const busy = ref(false)
const editor = ref(false)
const editKey = ref('')
const editValue = ref('')
const editMode = ref<'create' | 'update'>('create')

const load = async (): Promise<void> => {
    if (!pluginId.value) return

    busy.value = true

    try {
        const offset = (page.value - 1) * pageSize
        const search = new URLSearchParams({
            pluginId: pluginId.value,
            limit: String(pageSize),
            offset: String(offset),
        })

        if (prefix.value) search.set('prefix', prefix.value)

        const data = await apiGet<{
            items: KvItem[]
            total: number
        }>(`/api/kv?${search.toString()}`)

        items.value = data.items
        total.value = data.total
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const onPage = (value: number): void => {
    page.value = value
    void load()
}

const startEdit = (): void => {
    editMode.value = 'create'
    editKey.value = ''
    editValue.value = 'null'
    editor.value = true
}

const edit = (row: KvItem): void => {
    editMode.value = 'update'
    editKey.value = row.key
    editValue.value = JSON.stringify(row.value, undefined, 2)
    editor.value = true
}

const save = async (): Promise<void> => {
    let value: unknown

    try {
        value = JSON.parse(editValue.value) as unknown
    } catch {
        ElMessage.error('不是合法的 JSON')

        return
    }

    try {
        await apiPut('/api/kv', {
            pluginId: pluginId.value,
            key: editKey.value,
            value,
        })
        editor.value = false
        await load()
    } catch (error) {
        showError(error)
    }
}

const remove = async (row: KvItem): Promise<void> => {
    try {
        await apiDelete(
            `/api/kv?pluginId=${encodeURIComponent(pluginId.value)}&key=${encodeURIComponent(row.key)}`
        )
        await load()
    } catch (error) {
        showError(error)
    }
}

const display = (value: unknown): string => {
    if (typeof value === 'string')
        return value.length > 120 ? value.slice(0, 120) + '…' : value

    return JSON.stringify(value)?.slice(0, 120) ?? ''
}

onMounted(async () => {
    try {
        plugins.value = await apiGet<KvPlugin[]>('/api/kv/plugins')

        if (plugins.value.length > 0) {
            pluginId.value = plugins.value[0]?.pluginId ?? ''
            await load()
        }
    } catch (error) {
        showError(error)
    }
})
</script>

<style scoped>
.block {
    margin-bottom: 12px;
}

.pager {
    margin-top: 12px;
}
</style>
