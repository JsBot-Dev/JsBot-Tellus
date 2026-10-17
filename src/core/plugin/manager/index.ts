import path from 'node:path'
import { PluginLoad } from './load'
import { PluginRegister } from './register'
import type { JsBotPluginManagerOptions } from './types'
import { fileURLToPath } from 'node:url'

class PluginManager {
    load: PluginLoad
    register: PluginRegister
    constructor() {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        this.load = new PluginLoad(
            path.join(__dirname, '..', '..', '..', '/plugins')
        )
        this.register = new PluginRegister()
    }
}

export { PluginManager }
