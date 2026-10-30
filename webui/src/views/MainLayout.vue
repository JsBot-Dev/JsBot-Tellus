<template>
    <el-container class="layout">
        <el-aside width="232px" class="sidebar">
            <div class="brand">
                <div class="logo">J</div>
                <div class="brand-text">
                    <h2>JsBot 控制台</h2>
                    <p>Tellus · {{ version }}</p>
                </div>
            </div>

            <nav class="nav">
                <router-link
                    v-for="item in nav"
                    :key="item.key"
                    :to="{ name: item.key }"
                    class="nav-item"
                    :class="{ active: route.name === item.key }"
                >
                    <el-icon :size="17">
                        <component :is="item.icon" />
                    </el-icon>
                    <span>{{ item.label }}</span>
                </router-link>
            </nav>

            <div class="sidebar-footer">
                <span class="status-dot" :class="connected ? 'ok' : 'off'" />
                <span>{{ connected ? '运行时在线' : '运行时离线' }}</span>
            </div>
        </el-aside>

        <el-container>
            <el-header class="header">
                <span class="title">{{ pageTitle }}</span>
                <span class="spacer" />

                <el-tooltip
                    :content="isDark ? '切换到亮色模式' : '切换到暗色模式'"
                    placement="bottom"
                >
                    <el-button
                        text
                        circle
                        class="theme-toggle"
                        @click="onToggleTheme($event)"
                    >
                        <el-icon :size="17">
                            <Sunny v-if="isDark" />
                            <Moon v-else />
                        </el-icon>
                    </el-button>
                </el-tooltip>

                <el-tooltip content="外观设置" placement="bottom">
                    <el-button
                        text
                        circle
                        class="theme-toggle"
                        @click="appearanceOpen = true"
                    >
                        <el-icon :size="17"><Brush /></el-icon>
                    </el-button>
                </el-tooltip>

                <el-dropdown trigger="click" @command="onCommand">
                    <span class="user">
                        <span class="avatar">{{ avatarText }}</span>
                        <span class="username">{{ username }}</span>
                    </span>
                    <template #dropdown>
                        <el-dropdown-menu>
                            <el-dropdown-item command="logout">
                                退出登录
                            </el-dropdown-item>
                        </el-dropdown-menu>
                    </template>
                </el-dropdown>
            </el-header>

            <el-main class="main">
                <router-view v-slot="{ Component }">
                    <transition name="route-fade" mode="out-in">
                        <component :is="Component" />
                    </transition>
                </router-view>
            </el-main>
        </el-container>

        <AppearanceDrawer v-model="appearanceOpen" />
    </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
    Bell,
    ChatDotRound,
    Coin,
    Document,
    Box,
    MagicStick,
    Monitor,
    Moon,
    Setting,
    Sunny,
} from '@element-plus/icons-vue'
import { ref as vueRef } from 'vue'
import AppearanceDrawer from './AppearanceDrawer.vue'
import {
    apiGet,
    apiPost,
    errorMessage,
    fetchStatus,
    type AuthMe,
    type Status,
} from '@/api'
import {
    currentMode,
    toggleMode,
    subscribeAppearance,
    type AppearanceMode,
} from '@/appearance'

interface NavItem {
    key: string
    label: string
    icon: Component
}

const route = useRoute()
const router = useRouter()

const nav: NavItem[] = [
    { key: 'dashboard', label: '概览', icon: Monitor },
    { key: 'sessions', label: '会话', icon: ChatDotRound },
    { key: 'plugins', label: '插件', icon: Box },
    { key: 'config', label: '配置', icon: Setting },
    { key: 'kv', label: 'KV 存储', icon: Coin },
    { key: 'logs', label: '日志', icon: Document },
    { key: 'events', label: '事件', icon: Bell },
    { key: 'actions', label: '调试 Action', icon: MagicStick },
]

const titles: Record<string, string> = {
    dashboard: '概览',
    sessions: '会话',
    plugins: '插件',
    config: '配置',
    kv: 'KV 存储',
    logs: '日志',
    events: '事件',
    actions: '调试 Action',
}

const username = ref('')
const version = ref('0.0.0')
const connected = ref(false)
const isDark = vueRef<AppearanceMode>(currentMode())
const appearanceOpen = vueRef(false)

const onToggleTheme = (event: MouseEvent): void => {
    isDark.value = toggleMode({ x: event.clientX, y: event.clientY })
}

const onAppearanceChanged = (): void => {
    isDark.value = currentMode()
}

let unsubscribeAppearance: (() => void) | null = null

const pageTitle = computed(
    () => titles[route.name as string] ?? titles[route.path] ?? 'JsBot'
)
const avatarText = computed(() =>
    username.value ? username.value.slice(0, 1).toUpperCase() : '?'
)

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
    void apiGet<AuthMe>('/api/auth/me').then((me) => {
        username.value = me.username
    })

    void refreshStatus()

    pollTimer = setInterval(() => void refreshStatus(), 10_000)

    unsubscribeAppearance = subscribeAppearance(onAppearanceChanged)
    // 首次挂载把跟随系统模式的初始值也归一
    isDark.value = currentMode()
})

onUnmounted(() => {
    if (pollTimer !== null) clearInterval(pollTimer)
    if (unsubscribeAppearance !== null) unsubscribeAppearance()
})

const refreshStatus = async (): Promise<void> => {
    try {
        const status: Status = await fetchStatus()

        version.value = status.version
        connected.value = status.runtime?.connected ?? false
    } catch {
        connected.value = false
    }
}

const onCommand = (command: string): void => {
    if (command === 'logout') void logout()
}

const logout = async (): Promise<void> => {
    try {
        await apiPost('/api/auth/logout')
    } catch (error) {
        console.warn('logout failed:', errorMessage(error))
    }

    await router.push({ name: 'login' })
}
</script>

<style scoped>
.layout {
    height: 100%;
    background: var(--app-bg);
}

.sidebar {
    display: flex;
    flex-direction: column;
    background: var(--app-side-bg);
    border-right: 1px solid var(--app-border);
    color: var(--app-muted);
    transition: background 0.2s ease;
}

.brand {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 22px 20px 18px;
}

.logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    font-weight: 700;
    color: #fff;
    border-radius: 10px;
    background: linear-gradient(
        135deg,
        oklch(68.5% 0.155 230),
        oklch(56% 0.15 250)
    );
    box-shadow: 0 8px 20px
        color-mix(in oklab, var(--app-accent) 35%, transparent);
    flex: none;
}

.brand-text h2 {
    margin: 0;
    font-size: 14.5px;
    color: var(--app-text);
    letter-spacing: 0.02em;
}

.brand-text p {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--app-muted);
}

.nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 12px;
    margin-top: 4px;
    flex: 1;
}

.nav-item {
    position: relative;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 9px 13px;
    font-size: 13.5px;
    color: var(--app-muted) !important;
    text-decoration: none;
    border-radius: 9px;
    transition:
        background 0.14s ease,
        color 0.14s ease;
}

.nav-item:hover {
    background: var(--app-nav-hover);
    color: var(--app-text) !important;
}

.nav-item.active {
    color: var(--app-accent) !important;
    background: color-mix(in oklab, var(--app-accent) 12%, transparent);
}

.nav-item.active::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 20%;
    bottom: 20%;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(
        180deg,
        oklch(68.5% 0.155 230),
        oklch(56% 0.15 250)
    );
}

.sidebar-footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 14px 20px;
    font-size: 12px;
    border-top: 1px solid var(--app-border);
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
}

.status-dot.ok {
    background: var(--app-ok);
    box-shadow: 0 0 10px color-mix(in oklab, var(--app-ok) 70%, transparent);
}

.status-dot.off {
    background: var(--app-dot-off);
}

.header {
    display: flex;
    align-items: center;
    height: 58px;
    padding: 0 24px;
    background: var(--app-glass);
    border-bottom: 1px solid var(--app-border);
    backdrop-filter: blur(12px);
}

.title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--app-text);
}

.spacer {
    flex: 1;
}

.theme-toggle {
    margin-right: 6px;
    color: var(--app-muted);
}

.user {
    display: flex;
    gap: 9px;
    align-items: center;
    color: var(--app-text);
    cursor: pointer;
    padding: 4px 6px 4px 4px;
    border-radius: 999px;
    transition: background 0.14s ease;
}

.user:hover {
    background: var(--app-nav-hover);
}

.avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    font-size: 12.5px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(
        135deg,
        oklch(68.5% 0.155 230),
        oklch(56% 0.15 250)
    );
    border-radius: 999px;
}

.username {
    font-size: 13px;
}

.main {
    padding: 22px 24px;
}
</style>
