import fg from 'fast-glob'
import { pathToFileURL } from 'node:url'
import { JsBotBasePlugin } from '../base'
import type { JsBot } from '../../bot'
import type { Plugins } from '../../types/type'
import type { LoadPlugins, PluginConstructor } from './types'

class PluginLoad {
    constructor(readonly dir: string) {}
    async load(): Promise<LoadPlugins> {
        const files = await fg('plugin-*/index.ts', {
            cwd: this.dir,
            absolute: true,
        })
        if (!files.length) throw new Error(`未找到插件：${this.dir}`)
        const collections: LoadPlugins = {
            internal: [],
            integrated: [],
            custom: [],
        }

        for (const file of files) {
            const Plugin = (await import(pathToFileURL(file).href))
                .default as PluginConstructor
            if (
                typeof Plugin !== 'function' ||
                !(Plugin.prototype instanceof JsBotBasePlugin)
            ) {
                throw new Error(
                    `${file} 中的默认导出不是 JsBotBasePlugin 的子类`
                )
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
        return collections
    }

    instantiate(bot: JsBot, collections: LoadPlugins): Plugins {
        const instantiatePlugins = (constructors: PluginConstructor[]) =>
            constructors.map((Plugin) => {
                const plugin = new Plugin(bot)
                plugin.logger.info('插件初始化完成')
                return plugin
            })

        return {
            internal: instantiatePlugins(collections.internal),
            integrated: instantiatePlugins(collections.integrated),
            custom: instantiatePlugins(collections.custom),
        }
    }
}

export { PluginLoad }
