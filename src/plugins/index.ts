import type { AnyPluginDefinition } from '../core/index.js'
import { adminPlugin } from './admin/index.js'
import { corePlugin } from './core/index.js'
import { llmPlugin } from './llm/index.js'
import { pokePlugin } from './poke/index.js'

export const builtinPlugins: AnyPluginDefinition[] = [
    corePlugin,
    adminPlugin,
    pokePlugin,
    llmPlugin,
]
