import { JsBot } from "./core/bot";

const bot = new JsBot();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        void bot.stop().then(
            () => { process.exitCode = signal === 'SIGINT' ? 130 : 143 },
            error => {
                console.error('Failed to stop bot:', error)
                process.exitCode = 1
            }
        )
    })
}

try {
    await bot.start()
} catch (error) {
    await bot.stop()
    throw error
}
