<template>
    <div>
        <el-tabs v-model="tab">
            <el-tab-pane label="常用设置" name="form">
                <el-form label-width="140px" size="small" class="form">
                    <el-divider content-position="left">连接</el-divider>
                    <el-form-item label="ws url">
                        <el-input v-model="form.url" />
                    </el-form-item>
                    <el-form-item label="accessToken">
                        <el-input
                            v-model="form.accessToken"
                            :placeholder="
                                meta.accessTokenSet ? '留空保持不变' : '未设置'
                            "
                        />
                    </el-form-item>

                    <el-divider content-position="left">WebUI</el-divider>
                    <el-form-item label="enabled">
                        <el-switch v-model="form.webui.enabled" />
                    </el-form-item>
                    <el-form-item label="host / port">
                        <el-space>
                            <el-input
                                v-model="form.webui.host"
                                style="width: 160px"
                            />
                            <el-input-number
                                v-model="form.webui.port"
                                :min="1"
                                :max="65535"
                            />
                        </el-space>
                    </el-form-item>
                    <el-form-item label="username">
                        <el-input
                            v-model="form.webui.username"
                            style="width: 200px"
                        />
                    </el-form-item>
                    <el-form-item label="password">
                        <el-input
                            v-model="webuiPassword"
                            show-password
                            :placeholder="
                                meta.webuiPasswordSet
                                    ? '留空保持不变'
                                    : '未设置'
                            "
                            style="width: 240px"
                        />
                    </el-form-item>
                    <el-form-item label="sessionTtlHours">
                        <el-input-number
                            v-model="form.webui.sessionTtlHours"
                            :min="1"
                            :max="720"
                        />
                    </el-form-item>
                    <el-form-item label="trustProxy">
                        <el-switch v-model="form.webui.trustProxy" />
                    </el-form-item>

                    <el-divider content-position="left">消息聚合</el-divider>
                    <el-form-item label="charThreshold">
                        <el-input-number
                            v-model="form.message.charThreshold"
                            :min="1"
                        />
                    </el-form-item>
                    <el-form-item label="lineThreshold">
                        <el-input-number
                            v-model="form.message.lineThreshold"
                            :min="1"
                        />
                    </el-form-item>

                    <el-divider content-position="left">安装器</el-divider>
                    <el-form-item label="enabled">
                        <el-switch v-model="form.installer.enabled" />
                    </el-form-item>
                    <el-form-item label="registry">
                        <el-input v-model="form.installer.registry" />
                    </el-form-item>
                    <el-form-item label="allowedPackages">
                        <el-input
                            :model-value="join(form.installer.allowedPackages)"
                            @update:model-value="
                                splitTo(
                                    form.installer,
                                    'allowedPackages',
                                    $event
                                )
                            "
                        />
                    </el-form-item>
                    <el-form-item label="allowScripts">
                        <el-switch v-model="form.installer.allowScripts" />
                    </el-form-item>
                    <el-form-item label="timeoutMs">
                        <el-input-number
                            v-model="form.installer.timeoutMs"
                            :min="1000"
                            :max="600000"
                        />
                    </el-form-item>

                    <el-divider content-position="left">角色</el-divider>
                    <el-form-item label="superadmin">
                        <el-input
                            :model-value="join(form.roles.superadmin)"
                            placeholder="逗号分隔的 QQ 号"
                            @update:model-value="
                                splitTo(
                                    form.roles,
                                    'superadmin',
                                    $event,
                                    Number
                                )
                            "
                        />
                    </el-form-item>
                    <el-form-item label="admin">
                        <el-input
                            :model-value="join(form.roles.admin)"
                            placeholder="逗号分隔的 QQ 号"
                            @update:model-value="
                                splitTo(form.roles, 'admin', $event, Number)
                            "
                        />
                    </el-form-item>

                    <el-form-item>
                        <el-space>
                            <el-button
                                type="primary"
                                :loading="busy"
                                @click="save"
                            >
                                校验并保存
                            </el-button>
                            <el-button @click="validateOnly">
                                仅校验
                            </el-button>
                        </el-space>
                    </el-form-item>
                </el-form>
            </el-tab-pane>

            <el-tab-pane label="JSON 编辑器" name="json">
                <el-input
                    v-model="jsonText"
                    type="textarea"
                    :rows="24"
                    spellcheck="false"
                    class="json-editor"
                />
                <div class="block">
                    <el-space>
                        <el-button @click="fillJson">从表单生成</el-button>
                        <el-button @click="applyJson">应用到表单</el-button>
                        <el-button
                            type="primary"
                            :loading="busy"
                            @click="saveJson"
                        >
                            校验并保存
                        </el-button>
                    </el-space>
                </div>
            </el-tab-pane>
        </el-tabs>

        <el-alert
            v-if="issues.length > 0"
            type="error"
            :closable="false"
            class="block"
        >
            <ul class="issues">
                <li v-for="(issue, index) in issues" :key="index">
                    {{ issue.path ? issue.path + ': ' : '' }}{{ issue.message }}
                </li>
            </ul>
        </el-alert>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { apiGet, apiPost, apiPut, showError } from '@/api'

interface ConfigForm {
    url: string
    accessToken: string
    roles: {
        superadmin: number[]
        admin: number[]
    }
    message: {
        charThreshold: number
        lineThreshold: number
    }
    webui: {
        enabled: boolean
        host: string
        port: number
        username: string
        password: string
        sessionTtlHours: number
        trustProxy: boolean
    }
    installer: {
        enabled: boolean
        registry: string
        allowedPackages: string[]
        allowScripts: boolean
        timeoutMs: number
    }
}

interface ConfigMeta {
    path: string
    hash: string
    accessTokenSet: boolean
    webuiPasswordSet: boolean
}

const tab = ref('form')
const form = ref<ConfigForm>({
    url: '',
    accessToken: '',
    roles: { superadmin: [], admin: [] },
    message: { charThreshold: 50, lineThreshold: 3 },
    webui: {
        enabled: false,
        host: '127.0.0.1',
        port: 8787,
        username: '',
        password: '',
        sessionTtlHours: 12,
        trustProxy: false,
    },
    installer: {
        enabled: false,
        registry: 'https://registry.npmjs.org/',
        allowedPackages: [],
        allowScripts: false,
        timeoutMs: 120000,
    },
})
const webuiPassword = ref('')
const meta = ref<ConfigMeta>({
    path: '',
    hash: '',
    accessTokenSet: false,
    webuiPasswordSet: false,
})
const jsonText = ref('')
const issues = ref<Array<{ path: string; message: string }>>([])
const busy = ref(false)

const buildPayload = (): Record<string, unknown> => {
    const value = JSON.parse(JSON.stringify(form.value)) as Record<
        string,
        unknown
    >
    const webui = value['webui'] as Record<string, unknown>

    if (webuiPassword.value === '') {
        delete webui['password']
    } else {
        webui['password'] = webuiPassword.value
    }

    if ((value['accessToken'] as string) === '') delete value['accessToken']

    return value
}

const fillJson = (): void => {
    jsonText.value = JSON.stringify(buildPayload(), null, 4)
}

const applyJson = (): void => {
    try {
        const parsed = JSON.parse(jsonText.value) as Record<string, unknown>
        const webui = (parsed['webui'] ?? {}) as Record<string, unknown>

        if (typeof webui['password'] === 'string') {
            webuiPassword.value = webui['password'] === '' ? '' : '00000000'
        }

        if (
            typeof parsed['accessToken'] === 'string' &&
            parsed['accessToken'] === ''
        ) {
            parsed['accessToken'] = ''
        } else if (typeof parsed['accessToken'] === 'string') {
            parsed['accessToken'] = '00000000'
        }

        form.value = parsed as unknown as ConfigForm
        ElMessage.success('已应用到表单')
    } catch (error) {
        ElMessage.error('JSON 格式错误')
        console.warn(error)
    }
}

const validate = async (config: Record<string, unknown>): Promise<boolean> => {
    const result = await apiPost<{
        ok: boolean
        issues: Array<{ path: string; message: string }>
    }>('/api/config/validate', { config })

    issues.value = result.issues

    return result.ok
}

const validateOnly = async (): Promise<void> => {
    busy.value = true

    try {
        const ok = await validate(buildPayload())

        if (ok) ElMessage.success('校验通过')
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const saveJson = async (): Promise<void> => {
    let payload: unknown

    try {
        payload = JSON.parse(jsonText.value)
    } catch {
        ElMessage.error('JSON 格式错误')

        return
    }

    await savePayload(payload as Record<string, unknown>, webuiPassword.value)
}

const save = async (): Promise<void> => {
    const payload = buildPayload()

    webuiPassword.value = (payload['webui'] as Record<string, unknown>)[
        'password'
    ] as string

    await savePayload(payload, webuiPassword.value)
    issues.value = []
}

const savePayload = async (
    payload: Record<string, unknown>,
    passwordValue: string
): Promise<void> => {
    busy.value = true

    try {
        const ok = await validate(payload)

        if (!ok && issues.value.length > 0) {
            ElMessage.error('校验失败')

            return
        }

        const result = await apiPut<{ ok: boolean; error?: string }>(
            '/api/config',
            {
                config: payload,
                baseHash: meta.value.hash,
            }
        )

        if (!result.ok) {
            ElMessage.error(result.error ?? '保存失败')

            return
        }

        ElMessage.success('已保存并重启运行时')
        await load()
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}

const load = async (): Promise<void> => {
    try {
        const data = await apiGet<{ config: ConfigForm; meta: ConfigMeta }>(
            '/api/config'
        )

        form.value = data.config
        meta.value = data.meta
        webuiPassword.value =
            data.meta.webuiPasswordSet && data.config.webui.password === ''
                ? ''
                : ''
        jsonText.value = JSON.stringify(data.config, null, 4)
    } catch (error) {
        showError(error)
    }
}

const join = (values: number[] | string[]): string => values.join(', ')

function splitTo(
    target: Record<string, unknown>,
    key: string,
    text: string,
    transform?: (value: string) => unknown
): void {
    const items = text
        .split(/[,,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)

    target[key] = transform ? items.map(transform) : items
}

onMounted(() => void load())
</script>

<style scoped>
.form {
    max-width: 640px;
}

.block {
    margin-top: 12px;
}

.json-editor {
    font-family: monospace;
}

.issues {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
}
</style>
