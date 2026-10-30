<template>
    <div>
        <el-alert
            v-if="status?.startupError"
            :title="'运行时启动失败'"
            type="error"
            :closable="false"
            class="block"
        >
            <pre class="error-text">{{ status.startupError }}</pre>
        </el-alert>
        <el-alert
            v-else-if="status?.restarting"
            title="运行时正在重启…"
            type="warning"
            :closable="false"
            class="block"
        />

        <el-row :gutter="16" class="block">
            <el-col :span="6">
                <el-card class="stat-card">
                    <div class="stat">
                        <div class="chip sky">
                            <el-icon :size="18"><Link /></el-icon>
                        </div>
                        <div>
                            <p class="label">连接状态</p>
                            <p class="value small">
                                {{ runtime?.connected ? '已连接' : '未连接' }}
                            </p>
                            <p class="sub">
                                {{
                                    runtime?.login
                                        ? `${runtime.login.nickname} · ${runtime.login.userId}`
                                        : '—'
                                }}
                            </p>
                        </div>
                    </div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card class="stat-card">
                    <div class="stat">
                        <div class="chip emerald">
                            <el-icon :size="18"><Timer /></el-icon>
                        </div>
                        <div>
                            <p class="label">运行时长</p>
                            <p class="value">{{ uptime }}</p>
                            <p class="sub">
                                state: {{ runtime?.state ?? '—' }} · gen
                                {{ runtime?.generation ?? '—' }}
                            </p>
                        </div>
                    </div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card class="stat-card">
                    <div class="stat">
                        <div class="chip violet">
                            <el-icon :size="18"><Box /></el-icon>
                        </div>
                        <div>
                            <p class="label">插件</p>
                            <p class="value">
                                {{ runtime?.counts.loadedPlugins ?? '—'
                                }}<span class="unit">
                                    /
                                    {{ runtime?.counts.plugins ?? '—' }}
                                    已加载</span
                                >
                            </p>
                            <p class="sub">
                                启用 {{ runtime?.counts.enabledPlugins ?? '—' }}
                            </p>
                        </div>
                    </div>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card class="stat-card">
                    <div class="stat">
                        <div class="chip amber">
                            <el-icon :size="18"><ChatDotRound /></el-icon>
                        </div>
                        <div>
                            <p class="label">会话</p>
                            <p class="value">
                                {{ runtime?.counts.sessions ?? '—'
                                }}<span class="unit">
                                    · {{ runtime?.counts.kvPlugins ?? '—' }} KV
                                    插件</span
                                >
                            </p>
                            <p class="sub">session 记录数</p>
                        </div>
                    </div>
                </el-card>
            </el-col>
        </el-row>

        <el-card class="block">
            <template #header>运行时控制</template>
            <el-space>
                <el-button type="danger" :loading="busy" @click="restart">
                    重启运行时
                </el-button>
                <el-button @click="pause">暂停</el-button>
                <el-button @click="resume">恢复</el-button>
            </el-space>
            <p class="sub">
                version: {{ status?.version ?? '-' }} · paths:
                {{ status?.paths.config }}
            </p>
            <p
                v-if="status?.webui.requiresProcessRestart"
                class="sub warn-text"
            >
                webui 绑定配置已修改，需要重启进程生效。
            </p>
        </el-card>

        <el-card class="block">
            <template #header>命令列表</template>
            <el-table :data="commands" size="small" max-height="320">
                <el-table-column prop="id" label="命令" width="220" />
                <el-table-column prop="pluginId" label="插件" width="180" />
                <el-table-column prop="description" label="说明" />
            </el-table>
        </el-card>

        <el-card class="block">
            <template #header>最近事件</template>
            <el-table :data="recentEvents" size="small" max-height="320">
                <el-table-column label="时间" width="170">
                    <template #default="{ row }">
                        {{ formatTime(row.time) }}
                    </template>
                </el-table-column>
                <el-table-column prop="type" label="类型" width="100" />
                <el-table-column prop="summary" label="摘要" />
            </el-table>
        </el-card>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Box, ChatDotRound, Link, Timer } from '@element-plus/icons-vue'
import {
    apiPost,
    connectSse,
    fetchCommands,
    fetchStatus,
    formatTime,
    formatUptime,
    showError,
    type CommandInfo,
    type FeedEventItem,
    type Status,
} from '@/api'

const status = ref<Status | null>(null)
const commands = ref<CommandInfo[]>([])
const recentEvents = ref<FeedEventItem[]>([])
const busy = ref(false)
const runtime = computed(() => status.value?.runtime ?? null)
const uptime = computed(() =>
    runtime.value ? formatUptime(runtime.value.uptimeMs) : '-'
)

const refresh = async (): Promise<void> => {
    try {
        status.value = await fetchStatus()
    } catch (error) {
        showError(error)
    }
}

const restart = async (): Promise<void> => {
    busy.value = true

    try {
        await apiPost('/api/runtime/restart')
        await refresh()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const pause = async (): Promise<void> => {
    try {
        await apiPost('/api/runtime/pause')
        await refresh()
    } catch (error) {
        showError(error)
    }
}

const resume = async (): Promise<void> => {
    try {
        await apiPost('/api/runtime/resume')
        await refresh()
    } catch (error) {
        showError(error)
    }
}

let closeSse: (() => void) | null = null
let stopStatusPolling: (() => void) | null = null

onMounted(async () => {
    await refresh()

    commands.value = await fetchCommands().catch(() => [])
    closeSse = connectSse('/api/events/stream?limit=20', (data) => {
        recentEvents.value.unshift(data as FeedEventItem)

        if (recentEvents.value.length > 30) recentEvents.value.pop()
    })

    const timer = setInterval(() => void refresh(), 10_000)

    stopStatusPolling = () => clearInterval(timer)
})

onUnmounted(() => {
    closeSse?.()
    stopStatusPolling?.()
})
</script>

<style scoped>
.block {
    margin-bottom: 16px;
}

.stat {
    display: flex;
    gap: 14px;
    align-items: flex-start;
}

.chip {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 11px;
}

.chip.sky {
    color: color-mix(in oklab, var(--app-accent) 85%, black);
    background: color-mix(in oklab, var(--app-accent) 12%, transparent);
}

.chip.emerald {
    color: var(--app-ok);
    background: color-mix(in oklab, var(--app-ok) 12%, transparent);
}

.chip.violet {
    color: var(--app-violet);
    background: color-mix(in oklab, var(--app-violet) 12%, transparent);
}

.chip.amber {
    color: var(--app-warn);
    background: color-mix(in oklab, var(--app-warn) 12%, transparent);
}

.label {
    margin: 0;
    color: var(--app-muted);
    font-size: 12.5px;
}

.value {
    margin: 6px 0 0;
    font-size: 21px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.25;
}

.value.small {
    font-size: 16px;
}

.unit {
    font-size: 12px;
    font-weight: 500;
    color: var(--app-muted);
}

.sub {
    margin: 4px 0 0;
    color: var(--app-muted);
    font-size: 11.5px;
    word-break: break-all;
}

.warn-text {
    color: var(--app-warn);
}

.error-text {
    margin: 8px 0 0;
    white-space: pre-wrap;
    font-size: 12px;
}
</style>
