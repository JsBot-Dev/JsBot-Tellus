import type { JsBot } from "../../bot";
import type { PluginLevel } from "../../types/type";
import type { JsBotBasePlugin } from "../base";

interface JsBotPluginManagerOptions {
    url: string
}
interface LoadPlugins {
    custom: Array<PluginConstructor>
    integrated: Array<PluginConstructor>
    internal: Array<PluginConstructor>
}
type PluginConstructor = {
    new(bot: JsBot): JsBotBasePlugin
    ignore: boolean
    name: string
    level: PluginLevel
}
export type { JsBotPluginManagerOptions, PluginConstructor, LoadPlugins }