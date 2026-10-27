import type { AnyPluginDefinition } from '../core/index.js'
import { adminPlugin } from './admin/index.js'
import { corePlugin } from './core/index.js'

export const builtinPlugins: AnyPluginDefinition[] = [corePlugin, adminPlugin]
