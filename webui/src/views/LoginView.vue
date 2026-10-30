<template>
    <div class="login-page">
        <svg
            class="login-waves"
            viewBox="0 0 1440 900"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            <path
                d="M-40 250 C 180 180, 360 320, 620 250 S 1080 180, 1480 260"
            />
            <path
                d="M-40 420 C 200 340, 420 480, 700 410 S 1120 330, 1480 430"
            />
            <path
                d="M-40 580 C 220 500, 400 640, 660 570 S 1100 490, 1480 590"
            />
            <path
                d="M-40 730 C 180 660, 380 790, 640 725 S 1080 650, 1480 740"
            />
            <path d="M-40 130 C 240 70, 440 190, 720 125 S 1120 40, 1480 140" />
        </svg>

        <el-card class="login-card" :body-style="{ padding: '36px 32px 32px' }">
            <div class="brand">
                <div class="logo">J</div>
                <h2>JsBot 控制台</h2>
                <p>Tellus 管理后台</p>
            </div>

            <el-form label-position="top" size="large" @submit.prevent>
                <el-form-item label="用户名">
                    <el-input v-model="username" autocomplete="username" />
                </el-form-item>
                <el-form-item label="密码">
                    <el-input
                        v-model="password"
                        type="password"
                        autocomplete="current-password"
                        show-password
                        @keyup.enter="submit"
                    />
                </el-form-item>
                <el-button
                    type="primary"
                    size="large"
                    class="submit"
                    :loading="busy"
                    @click="submit"
                >
                    登 录
                </el-button>
            </el-form>
        </el-card>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiPost, showError, type AuthMe } from '@/api'

const router = useRouter()
const username = ref('')
const password = ref('')
const busy = ref(false)

const submit = async (): Promise<void> => {
    if (busy.value) return

    busy.value = true

    try {
        await apiPost<AuthMe>('/api/auth/login', {
            username: username.value,
            password: password.value,
        })

        await router.push({ name: 'dashboard' })
    } catch (error) {
        showError(error)
    } finally {
        busy.value = false
    }
}
</script>

<style scoped>
.login-page {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    background: var(--app-bg);
}

.login-card {
    position: relative;
    z-index: 1;
    width: 372px;
    background: var(--app-glass);
    backdrop-filter: blur(18px);
    box-shadow:
        var(--card-shadow),
        0 32px 80px -40px oklch(0% 0 0 / 0.35);
}

.brand {
    margin-bottom: 26px;
    text-align: center;
}

.logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    margin-bottom: 16px;
    font-size: 22px;
    font-weight: 700;
    color: var(--app-accent-fg);
    border-radius: 15px;
    background: linear-gradient(
        135deg,
        oklch(68.5% 0.155 230),
        oklch(56% 0.15 250)
    );
    box-shadow:
        inset 0 1px 0 oklch(100% 0 0 / 0.22),
        0 12px 28px oklch(68.5% 0.155 230 / 0.4);
}

.brand h2 {
    margin: 0;
    font-size: 18px;
    color: var(--app-text);
    letter-spacing: 0.02em;
}

.brand p {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--app-muted);
}

.submit {
    width: 100%;
    margin-top: 6px;
    font-weight: 600;
    letter-spacing: 0.35em;
}
</style>
