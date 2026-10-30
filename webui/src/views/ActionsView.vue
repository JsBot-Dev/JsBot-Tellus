<template>
    <div>
        <el-alert
            title="直接向 OneBot 调用任意 action。此功能等同完全特权接口，请谨慎使用。"
            type="warning"
            :closable="false"
            class="block"
        />

        <el-card class="block">
            <el-form label-width="100px" size="small">
                <el-form-item label="action">
                    <el-input
                        v-model="action"
                        placeholder="如 get_login_info / send_private_msg"
                        style="width: 320px"
                    />
                </el-form-item>
                <el-form-item label="params (JSON)">
                    <el-input
                        v-model="paramsText"
                        type="textarea"
                        :rows="5"
                        spellcheck="false"
                        placeholder="{}"
                    />
                </el-form-item>
                <el-form-item>
                    <el-button
                        type="primary"
                        :loading="busy"
                        :disabled="runtimeDown"
                        @click="call"
                    >
                        调用
                    </el-button>
                </el-form-item>
            </el-form>

            <el-divider>结果</el-divider>
            <pre class="result">{{ resultText }}</pre>
        </el-card>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { apiPost, fetchStatus, showError } from '@/api'

const action = ref('get_login_info')
const paramsText = ref('{}')
const resultText = ref('')
const busy = ref(false)
const runtimeDown = ref(true)

const call = async (): Promise<void> => {
    let params: unknown = {}

    if (
        paramsText.value.trim().length > 0 &&
        paramsText.value.trim() !== '{}'
    ) {
        try {
            params = JSON.parse(paramsText.value)
        } catch {
            ElMessage.error('params 必须是合法 JSON')

            return
        }
    }

    busy.value = true

    try {
        const result = await apiPost<{ result: unknown }>('/api/actions', {
            action: action.value,
            params,
        })

        resultText.value = JSON.stringify(result.result, undefined, 2)
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

onMounted(() => {
    void fetchStatus()
        .then((status) => {
            runtimeDown.value = status.runtime === null
        })
        .catch(() => {
            runtimeDown.value = true
        })
})
</script>

<style scoped>
.block {
    margin-bottom: 16px;
}

.result {
    margin: 0;
    padding: 12px;
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    color: var(--app-text);
    white-space: pre-wrap;
    font-size: 12px;
    min-height: 80px;
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
}
</style>
