import type { Config } from '../core/config/schema'

export function isPluginEnableInGroup(
    botConfig: Config,
    name: string,
    group: number
) {
    const config = botConfig.plugin
    const plugin = config[name]
    if (!plugin) return true
    switch (plugin.status) {
        case 'Enable':
            if (plugin.list && plugin.list.length)
                return plugin.list.includes(group)
            else return true
        case 'Disable':
            if (plugin.list && plugin.list.length)
                return !plugin.list.includes(group)
            else return false
        default:
            return false
    }
}
