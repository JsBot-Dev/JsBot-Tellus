<template>
    <div>
        <el-card class="block">
            <el-space>
                <el-select
                    v-model="type"
                    placeholder="全部类型"
                    style="width: 140px"
                    clearable
                >
                    <el-option label="message" value="message" />
                    <el-option label="notice" value="notice" />
                    <el-option label="request" value="request" />
                    <el-option label="meta" value="meta" />
                    <el-option label="other" value="other" />
                </el-select>
                <el-select v-model="live" style="width: 90px">
                    <el-option label="实时" value="on" />
                    <el-option label="暂停" value="off" />
                </el-select>
                <el-button type="primary" @click="load">刷新</el-button>
            </el-space>
        </el-card>

        <el-card>
            <el-table :data="items" size="small" max-height="640">
                <el-table-column label="时间" width="170">
                    <template #default="{ row }">{{
                        formatTime(row.time)
                    }}</template>
                </el-table-column>
                <el-table-column prop="type" label="类型" width="100" />
                <el-table-column
                    prop="summary"
                    label="摘要"
                    show-overflow-tooltip
                />
                <el-table-column label="详情" width="90">
                    <template #default="{ row }">
                        <el-button size="small" @click="viewDetail(row)">
                            查看
                        </el-button>
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-drawer v-model="drawer" title="事件详情" size="50%">
            <pre class="json">{{ detailText }}</pre>
        </el-drawer>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
    apiGet,
    connectSse,
    formatTime,
    showError,
    type FeedEventItem,
} from '@/api'

const type = ref('')
const live = ref('on')
const items = ref<FeedEventItem[]>([])
const drawer = ref(false)
const detailText = ref('')

const load = async (): Promise<void> => {
    try {
        const params = new URLSearchParams({ limit: '300' })

        if (type.value) params.set('type', type.value)

        items.value = await apiGet<FeedEventItem[]>(
            `/api/events?${params.toString()}`
        )
    } catch (error) {
        showError(error)
    }
}

let closeSse: (() => void) | null = null

const reopen = (): void => {
    closeSse?.()
    closeSse = null

    if (live.value !== 'on') return

    closeSse = connectSse('/api/events/stream', (data) => {
        const event = data as FeedEventItem

        if (type.value && event.type !== type.value) return

        items.value.unshift(event)

        if (items.value.length > 500) items.value.length = 500
    })
}

watch(live, reopen)
watch(type, async () => {
    await load()
    reopen()
})

const viewDetail = (row: FeedEventItem): void => {
    detailText.value = JSON.stringify(row.event, undefined, 2)
    drawer.value = true
}

onMounted(async () => {
    await load()
    reopen()
})

onUnmounted(() => {
    closeSse?.()
})
</script>

<style scoped>
.block {
    margin-bottom: 16px;
}

.json {
    white-space: pre-wrap;
    font-size: 12px;
}
</style>
