import type { JsBot } from "../bot";
import type { PluginLevel } from "../types/type";

class JsBotBasePlugin {
    static readonly level: PluginLevel = 'Custom'
    static readonly ignore: boolean = false
    static readonly name: string = this.constructor.name
    constructor(readonly bot: JsBot) { }
    get_kv(key: string) {
        return this.bot.plugiDb!.get(this.constructor.name, key)
    }
    set_kv(key: string, value: any) {
        this.bot.plugiDb!.set(this.constructor.name, key, value)
    }
}

export { JsBotBasePlugin }
