<template>
    <el-drawer
        v-model="open"
        title="外观"
        size="336px"
        class="appearance-drawer"
        :append-to-body="true"
    >
        <div class="panel">
            <section class="group">
                <h4>模式</h4>
                <el-segmented
                    v-model="form.modeKey"
                    :options="modeOptions"
                    block
                    @change="onModeChange"
                />
            </section>

            <section v-if="!isLight" class="group">
                <h4>暗色强度</h4>
                <el-segmented
                    v-model="form.intensity"
                    :options="intensityOptions"
                    block
                    @change="onIntensityChange"
                />
            </section>

            <section class="group">
                <h4>密度</h4>
                <el-segmented
                    v-model="form.density"
                    :options="densityOptions"
                    block
                    @change="onDensityChange"
                />
            </section>

            <section class="group">
                <h4>侧边栏</h4>
                <el-segmented
                    v-model="form.sidebarStyle"
                    :options="sidebarOptions"
                    block
                    @change="onSidebarChange"
                />
            </section>

            <section class="group">
                <div class="slider-row">
                    <h4>界面缩放</h4>
                    <span class="slider-value">
                        {{ Math.round(form.uiScale * 100) }}%
                    </span>
                </div>
                <el-slider
                    v-model="form.uiScale"
                    :min="0.5"
                    :max="2"
                    :step="0.05"
                    :marks="scaleMarks"
                    @input="onScaleInput"
                    @change="commit"
                />
            </section>

            <section class="group">
                <div class="slider-row">
                    <h4>圆角</h4>
                    <span class="slider-value">
                        {{ form.radius.toFixed(2) }}rem
                    </span>
                </div>
                <el-slider
                    v-model="form.radius"
                    :min="0"
                    :max="2"
                    :step="0.125"
                    @input="onRadiusInput"
                />
            </section>

            <section class="group">
                <el-switch
                    v-model="form.highContrast"
                    active-text="高对比度"
                    @change="commit"
                />
                <el-switch
                    v-model="form.reduceMotion"
                    active-text="减少动效"
                    @change="commit"
                />
                <el-switch
                    v-model="form.disableMotion"
                    active-text="关闭全部动效"
                    @change="commit"
                />
            </section>

            <el-button class="reset" text @click="onReset">
                恢复默认外观
            </el-button>
        </div>
    </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
    getAppearance,
    resetAppearance,
    setAppearance,
    type AppearanceMode,
    type DarkIntensity,
    type Density,
    type SidebarStyle,
} from '@/appearance'

const open = defineModel<boolean>({ required: true })

const appearance = getAppearance()

const form = reactive({
    modeKey: appearance.mode ?? ('system' as string),
    intensity: (appearance.darkIntensity ?? 'soft') as DarkIntensity,
    density: (appearance.density ?? 'cozy') as Density,
    sidebarStyle: (appearance.sidebarStyle ?? 'follow') as SidebarStyle,
    uiScale: appearance.uiScale ?? 1,
    radius: appearance.radius ?? 0.75,
    highContrast: appearance.highContrast === true,
    reduceMotion: appearance.reduceMotion === true,
    disableMotion: appearance.disableMotion === true,
})

const isLight = computed(() => form.modeKey === 'light')

watch(open, (value) => {
    if (!value) return

    const fresh = getAppearance()

    form.modeKey = fresh.mode ?? 'system'
    form.intensity = fresh.darkIntensity ?? 'soft'
    form.density = fresh.density ?? 'cozy'
    form.sidebarStyle = fresh.sidebarStyle ?? 'follow'
    form.uiScale = fresh.uiScale ?? 1
    form.radius = fresh.radius ?? 0.75
    form.highContrast = fresh.highContrast === true
    form.reduceMotion = fresh.reduceMotion === true
    form.disableMotion = fresh.disableMotion === true
})

const modeOptions = [
    { label: '跟随系统', value: 'system' },
    { label: '亮色', value: 'light' },
    { label: '暗色', value: 'dark' },
]

const intensityOptions = [
    { label: '柔和', value: 'soft' },
    { label: '纯黑', value: 'black' },
]

const densityOptions = [
    { label: '默认', value: 'cozy' },
    { label: '紧凑', value: 'compact' },
]

const sidebarOptions = [
    { label: '跟随画布', value: 'follow' },
    { label: '独立面板', value: 'panel' },
    { label: '带品牌色', value: 'accent' },
]

const scaleMarks = { 1: '100%' }

const onModeChange = (): void => {
    setAppearance({
        mode:
            form.modeKey === 'system'
                ? undefined
                : (form.modeKey as AppearanceMode),
    })
}

const onIntensityChange = (): void => {
    setAppearance({
        darkIntensity: form.modeKey === 'dark' ? form.intensity : undefined,
    })
}

const onDensityChange = (): void => {
    setAppearance({ density: form.density })
}

const onSidebarChange = (): void => {
    setAppearance({ sidebarStyle: form.sidebarStyle })
}

// 拖动过程实时预览（setAppearance 内部落盘，刷新也即时生效）
const onScaleInput = (): void => {
    setAppearance({ uiScale: form.uiScale })
}

const onRadiusInput = (): void => {
    setAppearance({ radius: form.radius })
}

const commit = (): void => {
    setAppearance({
        mode:
            form.modeKey === 'system'
                ? undefined
                : (form.modeKey as AppearanceMode),
        darkIntensity: form.modeKey === 'dark' ? form.intensity : undefined,
        density: form.density,
        sidebarStyle: form.sidebarStyle,
        uiScale: form.uiScale,
        radius: form.radius,
        highContrast: form.highContrast,
        reduceMotion: form.reduceMotion,
        disableMotion: form.disableMotion,
    })
}

const onReset = (): void => {
    resetAppearance()
}
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.group {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.group h4 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--app-muted);
    letter-spacing: 0.02em;
}

.slider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.slider-value {
    font-variant-numeric: tabular-nums;
    font-size: 12.5px;
    color: var(--app-accent);
}

.group .el-switch {
    width: fit-content;
}

.reset {
    align-self: flex-start;
    color: var(--app-muted);
}
</style>
