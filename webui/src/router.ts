import { createRouter, createWebHashHistory } from 'vue-router'
import { apiGet, errorMessage, type AuthMe } from './api'

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/login',
            name: 'login',
            component: () => import('./views/LoginView.vue'),
        },
        {
            path: '/',
            component: () => import('./views/MainLayout.vue'),
            children: [
                {
                    path: '',
                    redirect: { name: 'dashboard' },
                },
                {
                    path: 'dashboard',
                    name: 'dashboard',
                    component: () => import('./views/DashboardView.vue'),
                },
                {
                    path: 'sessions',
                    name: 'sessions',
                    component: () => import('./views/SessionsView.vue'),
                },
                {
                    path: 'plugins',
                    name: 'plugins',
                    component: () => import('./views/PluginsView.vue'),
                },
                {
                    path: 'config',
                    name: 'config',
                    component: () => import('./views/ConfigView.vue'),
                },
                {
                    path: 'kv',
                    name: 'kv',
                    component: () => import('./views/KvView.vue'),
                },
                {
                    path: 'logs',
                    name: 'logs',
                    component: () => import('./views/LogsView.vue'),
                },
                {
                    path: 'events',
                    name: 'events',
                    component: () => import('./views/EventsView.vue'),
                },
                {
                    path: 'actions',
                    name: 'actions',
                    component: () => import('./views/ActionsView.vue'),
                },
            ],
        },
        {
            path: '/:pathMatch(.*)*',
            redirect: { name: 'dashboard' },
        },
    ],
})

let authChecked = false

router.beforeEach(async (to) => {
    if (to.name === 'login') return true

    if (authChecked) return true

    try {
        await apiGet<AuthMe>('/api/auth/me')
        authChecked = true

        return true
    } catch (error) {
        console.warn('auth check failed:', errorMessage(error))

        return { name: 'login' }
    }
})

export default router
