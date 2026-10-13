import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema, type Config } from "./schema";
import type { z } from "zod";
import { readFileSync } from "node:fs";

class ReadConfig {
    private configPath: string
    constructor(configPath?: string) {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        if (!configPath) {
            this.configPath = path.join(__dirname, '..', '..', '..', 'bot.config.json')
        } else {
            this.configPath = configPath
        }
    }
    read(): Config {
        const raw = readFileSync(this.configPath, 'utf-8')
        const config = ConfigSchema.parse(JSON.parse(raw))
        return config
    }
}

export { ReadConfig }