import { ReadConfig } from './read'

class ConfigManager {
    read: ReadConfig
    constructor(configPath?: string) {
        this.read = new ReadConfig(configPath)
    }
}

export { ConfigManager }
