import { KVSqlite } from '@isdk/kvsqlite'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadPlugins } from '../plugin/manager/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export class KvData {
    db: KVSqlite
    constructor(plugins: LoadPlugins) {
        const namespaces = Object.values(plugins)
            .flat()
            .map((Plugin) => Plugin.name)
        this.db = new KVSqlite(
            path.join(__dirname, '../../data/db/plugin-kv.db'),
            {
                collections: namespaces,
            }
        )
    }
    set(collection: string, key: string, value: any) {
        return this.db.set({ _id: key, value }, { collection })
    }
    get(collection: string, key: string) {
        return this.db.get(key, { collection })?.值
    }
}
