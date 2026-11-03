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

        <el-row class="stat-grid block">
            <el-col :span="6">
                <el-card class="stat-card">
                    <div class="stat">
                        <div class="chip sky">
                            <el-icon size="1.125rem"><Link /></el-icon>
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
                            <el-icon size="1.125rem"><Timer /></el-icon>
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
                            <el-icon size="1.125rem"><Box /></el-icon>
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
                            <el-icon size="1.125rem"><ChatDotRound /></el-icon>
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
                <el-table-column
                    prop="name"
                    label="命令"
                    :width="scaledPx(220)"
                />
                <el-table-column label="别名" :width="scaledPx(200)">
                    <template #default="{ row }">
                        {{ (row.aliases ?? []).join(', ') || '—' }}
                    </template>
                </el-table-column>
                <el-table-column
                    prop="pluginId"
                    label="插件"
                    :width="scaledPx(220)"
                />
                <el-table-column label="说明 / 用法" :min-width="scaledPx(240)">
                    <template #default="{ row }">
                        {{ row.description || row.usage || '—' }}
                    </template>
                </el-table-column>
            </el-table>
        </el-card>

        <el-card class="block">
            <template #header>最近事件</template>
            <el-table :data="recentEvents" size="small" max-height="320">
                <el-table-column label="时间" :width="scaledPx(170)">
                    <template #default="{ row }">
                        {{ formatTime(row.time) }}
                    </template>
                </el-table-column>
                <el-table-column
                    prop="type"
                    label="类型"
                    :width="scaledPx(100)"
                />
                <el-table-column
                    prop="summary"
                    label="摘要"
                    :min-width="scaledPx(240)"
                />
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
import { scaledPx } from '@/use-ui-scale'

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
    margin-bottom: 1rem;
}

/* Grid keeps the four stat cards equal at 100% and lets them reflow when the
   appearance scale or a narrower viewport leaves less room. */
.stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 1rem;
}

.stat-grid :deep(.el-col) {
    width: auto;
    max-width: none;
    flex: none;
    padding: 0;
}

.stat {
    display: flex;
    gap: 0.875rem;
    align-items: flex-start;
}

.chip {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.6875rem;
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
    font-size: 0.78125rem;
}

.value {
    margin: 0.375rem 0 0;
    font-size: 1.3125rem;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.25;
}

.value.small {
    font-size: 1rem;
}

.unit {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--app-muted);
}

.sub {
    margin: 0.25rem 0 0;
    color: var(--app-muted);
    font-size: 0.71875rem;
    word-break: break-all;
}

.warn-text {
    color: var(--app-warn);
}

.error-text {
    margin: 0.5rem 0 0;
    white-space: pre-wrap;
    font-size: 0.75rem;
}
</style>
