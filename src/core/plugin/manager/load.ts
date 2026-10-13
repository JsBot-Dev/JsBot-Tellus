import fg from "fast-glob";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsBotBasePlugin } from "../base";
import type { JsBot } from "../../bot";
import type { Plugins } from "../../types/type";
import type { LoadPlugins, PluginConstructor } from "./types";

class PluginLoad {
    constructor(readonly dir: string) { }
    async load(bot: JsBot) {
        const files = await fg(path.join(this.dir, '/plugin-*/index.ts'))
        const collections: LoadPlugins = { internal: [], integrated: [], custom: [] }

        for (const file of files) {
            const Plugin = (await import(pathToFileURL(file).href)).default as PluginConstructor
            if (typeof Plugin !== "function" || !(Plugin.prototype instanceof JsBotBasePlugin)) {
                throw new Error(`${file} 中的默认导出不是 JsBotBasePlugin 的子类`)
            }
            if (Plugin.ignore) continue
            switch (Plugin.level) {
                case 'Internal':
                    collections.internal.push(Plugin)
                    break
                case 'Integrated':
                    collections.integrated.push(Plugin)
                    break
                case 'Custom':
                    collections.custom.push(Plugin)
                    break
                default:
                    throw new Error(`Invalid Plugin Level`)
            }
        }
        const result: Plugins = {
            internal: collections.internal.map(con => new con(bot)),
            integrated: collections.integrated.map(con => new con(bot)),
            custom: collections.custom.map(con => new con(bot))
        }
        return result
    }
}

export { PluginLoad }
