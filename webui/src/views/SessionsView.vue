<template>
    <div>
        <el-card class="block">
            <el-space>
                <el-input
                    v-model="query"
                    placeholder="搜索 session id"
                    clearable
                    style="width: 260px"
                    @keyup.enter="load"
                />
                <el-button type="primary" @click="load">搜索</el-button>
            </el-space>
        </el-card>

        <el-card>
            <el-table
                v-loading="busy"
                :data="items"
                size="small"
                @row-click="openDetail"
            >
                <el-table-column
                    prop="sessionId"
                    label="Session ID"
                    show-overflow-tooltip
                />
                <el-table-column label="消息数" width="90">
                    <template #default="{ row }">
                        {{ row.messageCount }}
                    </template>
                </el-table-column>
                <el-table-column label="更新时间" width="180">
                    <template #default="{ row }">
                        {{ formatTime(row.updatedAt) }}
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="160">
                    <template #default="{ row }">
                        <el-button size="small" @click.stop="openDetail(row)">
                            详情
                        </el-button>
                        <el-button
                            size="small"
                            type="danger"
                            @click.stop="clearSession(row)"
                        >
                            清空
                        </el-button>
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

        <el-drawer v-model="drawer" size="45%" :title="'会话 ' + detailId">
            <div v-if="detail">
                <el-form label-width="90px" size="small">
                    <el-form-item label="provider">
                        <el-input v-model="form.provider" />
                    </el-form-item>
                    <el-form-item label="model">
                        <el-input v-model="form.model" />
                    </el-form-item>
                    <el-form-item label="persona">
                        <el-input
                            v-model="form.persona"
                            type="textarea"
                            :rows="3"
                        />
                    </el-form-item>
                    <el-form-item>
                        <el-button type="primary" @click="saveDetail">
                            保存
                        </el-button>
                    </el-form-item>
                </el-form>

                <el-divider>LLM 消息</el-divider>

                <div
                    v-for="(message, index) in detail.messages"
                    :key="index"
                    class="message"
                >
                    <el-tag size="small" :type="roleColor(message.role)">
                        {{ message.role }}
                    </el-tag>
                    <pre class="message-content">{{ message.content }}</pre>
                </div>
                <p v-if="detail.messages.length === 0" class="sub">无消息</p>

                <el-input
                    v-model="newMessage"
                    type="textarea"
                    :rows="3"
                    placeholder="追加 role=user 消息"
                    class="block"
                />
                <el-button size="small" @click="appendMessage">追加</el-button>

                <el-divider>发送 QQ 消息</el-divider>
                <el-input
                    v-model="sendMessageText"
                    type="textarea"
                    :rows="3"
                    placeholder="发送到此 session（等同机器人回复）"
                    class="block"
                />
                <el-space>
                    <el-button
                        type="primary"
                        size="small"
                        :loading="sending"
                        @click="send"
                    >
                        发送
                    </el-button>
                    <el-checkbox v-model="autoEscape">autoEscape</el-checkbox>
                    <el-button type="danger" size="small" @click="clear">
                        清空会话
                    </el-button>
                </el-space>
            </div>
        </el-drawer>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import {
    apiDelete,
    apiGet,
    apiPost,
    apiPut,
    formatTime,
    showError,
} from '@/api'

interface SessionSummary {
    sessionId: string
    messageCount: number
    updatedAt: number
}

interface SessionMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
    at: number
}

interface SessionDetail {
    sessionId: string
    provider?: string
    model?: string
    persona?: string
    messages: SessionMessage[]
    updatedAt: number
}

const items = ref<SessionSummary[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const query = ref('')
const busy = ref(false)
const drawer = ref(false)
const detail = ref<SessionDetail | null>(null)
const detailId = ref('')
const form = ref({ provider: '', model: '', persona: '' })
const newMessage = ref('')
const sendMessageText = ref('')
const autoEscape = ref(true)
const sending = ref(false)

const load = async (): Promise<void> => {
    busy.value = true

    try {
        const offset = (page.value - 1) * pageSize
        const search = new URLSearchParams({
            limit: String(pageSize),
            offset: String(offset),
        })

        if (query.value) search.set('query', query.value)

        const data = await apiGet<{
            items: SessionSummary[]
            total: number
        }>(`/api/sessions?${search.toString()}`)

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

const openDetail = async (row: SessionSummary): Promise<void> => {
    try {
        const data = await apiGet<SessionDetail>(
            `/api/sessions/${encodeURIComponent(row.sessionId)}`
        )

        detail.value = data
        detailId.value = row.sessionId
        form.value = {
            provider: data.provider ?? '',
            model: data.model ?? '',
            persona: data.persona ?? '',
        }
        drawer.value = true
    } catch (error) {
        showError(error)
    }
}

const saveDetail = async (): Promise<void> => {
    if (detail.value === null) return

    try {
        detail.value = await apiPut<SessionDetail>(
            `/api/sessions/${encodeURIComponent(detailId.value)}`,
            {
                provider: form.value.provider || null,
                model: form.value.model || null,
                persona: form.value.persona || null,
            }
        )
        ElMessage.success('已保存')
        await load()
    } catch (error) {
        showError(error)
    }
}

const appendMessage = async (): Promise<void> => {
    if (detail.value === null || !newMessage.value) return

    try {
        detail.value = await apiPost<SessionDetail>(
            `/api/sessions/${encodeURIComponent(detailId.value)}/messages`,
            { role: 'user', content: newMessage.value }
        )
        newMessage.value = ''
    } catch (error) {
        showError(error)
    }
}

const send = async (): Promise<void> => {
    if (!sendMessageText.value) return

    sending.value = true

    try {
        await apiPost(
            `/api/sessions/${encodeURIComponent(detailId.value)}/send`,
            {
                message: sendMessageText.value,
                autoEscape: autoEscape.value,
            }
        )
        ElMessage.success('已发送')
        sendMessageText.value = ''
    } catch (error) {
        showError(error)
    } finally {
        sending.value = false
    }
}

const clear = async (): Promise<void> => {
    try {
        await apiDelete(`/api/sessions/${encodeURIComponent(detailId.value)}`)
        detail.value = null
        drawer.value = false
        await load()
    } catch (error) {
        showError(error)
    }
}

const clearSession = async (row: SessionSummary): Promise<void> => {
    try {
        await apiDelete(`/api/sessions/${encodeURIComponent(row.sessionId)}`)
        await load()
    } catch (error) {
        showError(error)
    }
}

const roleColor = (role: string): 'primary' | 'success' | 'warning' => {
    if (role === 'assistant') return 'success'
    if (role === 'system') return 'warning'

    return 'primary'
}

onMounted(() => void load())
</script>

<style scoped>
.block {
    margin-bottom: 16px;
}

.pager {
    margin-top: 12px;
}

.message {
    margin: 8px 0;
}

.message-content {
    margin: 4px 0 0;
    padding: 8px;
    background: var(--app-panel-2);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    color: var(--app-text);
    white-space: pre-wrap;
    font-size: 12px;
}

.sub {
    color: var(--app-muted);
    font-size: 12px;
}
</style>
