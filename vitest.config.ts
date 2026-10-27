import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

function resolve(path: string): string {
    return fileURLToPath(new URL(path, import.meta.url))
}

export default defineConfig({
    resolve: {
        alias: {
            '@jsbot-tellus/core': resolve('./src/core/index.ts'),
        },
    },
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
})
