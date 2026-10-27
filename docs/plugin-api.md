# 插件 API

## 入口

```ts
import { definePlugin } from '@jsbot/core'
import { z } from 'zod'

export default definePlugin({
    manifest: {
        id: 'demo',
        version: '1.0.0',
        description: 'Demo plugin',
        dependencies: ['core'],
        priority: 100,
        defaultEnabled: true,
        configSchema: z
            .object({
                reply: z.string().default('hello'),
            })
            .strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: 'demo',
                aliases: ['d'],
                permission: 'User',
            },
            async (_event, context) => {
                await context.send(ctx.config.reply)
            }
        )
    },
})
```

`definePlugin` 只做类型推导，不会产生全局副作用。插件必须有唯一的 `manifest.id`。

## Manifest

| 字段             | 说明                                               |
| ---------------- | -------------------------------------------------- |
| `id`             | 唯一插件 ID，也用于配置键、KV 命名空间和日志 scope |
| `version`        | 插件版本                                           |
| `description`    | 可选描述                                           |
| `dependencies`   | 依赖的插件 ID；依赖先于当前插件 setup/start        |
| `priority`       | 越大越先执行；依赖关系优先于 priority              |
| `defaultEnabled` | 配置没有写 `enabled` 时的默认值，默认 `false`      |
| `configSchema`   | Zod schema，只校验插件自己的配置                   |

公共信封字段 `enabled`、`private`、`groups` 由内核处理，不会传给 `configSchema`。

## 生命周期

```ts
export default definePlugin({
    manifest: { id: 'demo', version: '1.0.0', configSchema: z.object({}) },

    async setup(ctx) {
        const timer = setInterval(() => {}, 1000)

        return { timer }
    },

    async start(state) {
        // 连接已经建立，可以调用 ctx.api
    },

    async stop(state) {
        clearInterval(state.timer)
    },
})
```

- `setup(ctx)`：同步或异步；注册命令、事件和中间件。返回的 state 会传给 `start`/`stop`。
- `start(state)`：在 client 连接成功后调用。
- `stop(state)`：逆序调用；必须幂等，异常会被记录但不会阻断关闭。

`setup` 失败会回滚当前插件已经注册的能力。插件排序失败、依赖缺失、循环依赖、ID 重复都会导致启动失败。

## PluginContext

```ts
interface PluginContext<TConfig> {
    readonly id: string
    readonly config: Readonly<TConfig>
    readonly logger: Logger
    readonly kv: PluginKV
    readonly sessions: SessionStore
    readonly tasks: TaskQueue
    readonly api: BotApi
    readonly commands: CommandRegistrar
    readonly events: EventRegistrar
    readonly middlewares: MiddlewareRegistrar
    readonly core: CoreServices
}
```

### logger

```ts
ctx.logger.info('started')
ctx.logger.error('request failed', error)
```

会自动带上 `插件 ID` scope，并继承内核日志级别。

### kv

按插件 ID 隔离的持久化键值存储：

```ts
await ctx.kv.set('last', Date.now())
const last = await ctx.kv.get<number>('last')
await ctx.kv.delete('last')
const entries = await ctx.kv.list<number>('prefix:')
```

值使用 JSON 序列化，只适合小型状态。较长的对话历史使用 Session 而不是 KV。

### sessions

```ts
const session = await ctx.sessions.get(context.sessionId)
await ctx.sessions.append(context.sessionId, {
    role: 'user',
    content: 'hello',
    at: Date.now(),
})
await ctx.sessions.save({
    sessionId: context.sessionId,
    provider: 'example',
    model: 'model',
    messages: [],
    updatedAt: Date.now(),
})
```

Session ID 由内核生成：`group:<groupId>` 或 `private:<userId>`。插件不要自行拼接其它格式。

### tasks

```ts
ctx.tasks.enqueue(context.sessionId, async (signal) => {
    const result = await fetch(url, { signal })
    await ctx.api.send(context.sessionId, await result.text())
})
```

同一 key 串行执行，不同 key 并行。`Kernel.stop()` 会先 drain，再取消未完成任务。错误由队列记录，不会变成未处理的 Promise rejection。

### api

```ts
const login = await ctx.api.getLoginInfo()

await ctx.api.send('group:123456', '后台消息')

const result = await ctx.api.call('get_group_list')
```

`api.send` 使用 session ID 直接发送，不依赖事件上下文。`api.call` 透传 OneBot action。

### core

```ts
const role = ctx.core.roles.roleOf(userId)
const allowed = ctx.core.roles.can(role, 'Admin')
const commands = ctx.core.commands.list()
const plugins = ctx.core.plugins.list()
const uptime = ctx.core.uptime()

const installed = await ctx.core.installer.list()
```

核心服务由内核注入，适合帮助、状态类插件。`ctx.core.installer` 额外提供 `install` / `remove` / `update` / `list`；它不会检查调用者角色，权限判断由调用方负责（`admin` 的 `/plugin` 命令要求 SuperAdmin）。第三方插件不应把这些方法暴露给普通用户。

## 命令

```ts
ctx.commands.register(
    {
        name: 'echo',
        aliases: ['e'],
        prefixes: ['/'],
        permission: 'User',
        description: 'Echo text',
    },
    async (event, context, match) => {
        await context.send(match.rest)
    }
)
```

| 字段          | 默认值   | 说明                          |
| ------------- | -------- | ----------------------------- |
| `name`        | 必填     | 主命令名，匹配时大小写不敏感  |
| `aliases`     | `[]`     | 别名                          |
| `prefixes`    | `['/']`  | 前缀；空字符串表示无前缀      |
| `permission`  | `'User'` | `User`、`Admin`、`SuperAdmin` |
| `description` | 无       | `/help` 中展示                |

命令命中后会立即 `stopPropagation()`。同一前缀下的命令或别名冲突会在注册时抛错。

`CommandMatch`：

```ts
interface CommandMatch {
    command: string
    prefix: string
    args: string[]
    rest: string
}
```

## 事件

```ts
ctx.events.onMessage(async (event, context) => {
    if (event.raw_message === 'ping') {
        await context.send('pong')
    }
})

ctx.events.onNotice(
    { noticeType: 'notify', subType: 'poke' },
    async (event, context) => {
        await context.send('poked')
    }
)

ctx.events.onRequest({ requestType: 'friend' }, async (event) => {
    await ctx.api.call('set_friend_add_request', {
        flag: event.flag,
        approve: true,
    })
})
```

未匹配命令的消息才会进入 message handler。notice/request handler 会先按类型过滤，再检查插件 gating。

## 中间件

```ts
ctx.middlewares.use(
    {
        name: 'timing',
        eventTypes: ['message'],
        priority: 100,
    },
    async (_event, _context, next) => {
        const started = Date.now()

        await next()

        ctx.logger.debug(`handled in ${Date.now() - started}ms`)
    }
)
```

中间件在命令匹配之前运行，因此此时 `context.command` 为 `null`。需要在命令命中后拦截时，应使用命令 handler 或事件 handler。

- 默认只处理 `message`，可改为 `notice`、`request`、`meta` 或组合。
- 按 priority 降序执行。
- `next()` 重复调用只生效一次。
- 中间件异常会被记录，后续中间件仍会继续。
- `context.stopPropagation()` 会停止后续 Router 处理和 SDK middleware。

## 发送消息

```ts
await context.send('普通回复')
await context.send('不引用原消息', { quote: false })
await context.send('关闭自动转义', { autoEscape: false })
```

`EventContext.send` 的行为：

- 短消息默认通过 SDK `reply` 引用原消息。
- `quote: false` 时直接发到群或私聊。
- 超过 `message.charThreshold` 或 `lineThreshold` 时转为 forward。
- 发送失败会写日志并向调用方抛出。

## 权限与 gating

- `User` < `Admin` < `SuperAdmin`。
- `roles.superadmin` 和 `roles.admin` 在配置中维护。
- 用户权限不足时，命令不会执行，并回复一条通用提示。
- `plugins.<id>.enabled` 控制整体启用。
- `plugins.<id>.groups.allow` / `deny` 只作用于群事件，二者不能同时非空。
- `plugins.<id>.private` 控制私聊，默认 `true`。

## 配置校验

```ts
manifest: {
    id: 'demo',
    version: '1.0.0',
    configSchema: z
        .object({
            limit: z.number().int().positive().default(10),
        })
        .strict(),
}
```

配置位于：

```json
{
    "plugins": {
        "demo": {
            "enabled": true,
            "limit": 20
        }
    }
}
```

`enabled` 等信封字段会被剥离；`limit` 会传给 `configSchema`。未知字段会报错，错误信息包含 `plugins.demo.limit` 这样的路径。

## 外部插件

```bash
npm run build
node dist/app.js --plugin-dir examples/plugins
```

`--plugin-dir` 可以重复，`BOT_PLUGIN_DIR` 使用逗号分隔多个目录。应用会跳过与内置插件同 ID 的外部插件。加载器会扫描目录下所有 `.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.cts` 文件，识别：

- `export default plugin`
- `export const plugin = ...`
- `export const plugins = [...]`

TypeScript 插件必须在生产运行前编译为 JavaScript。外部插件和内置插件共用同一个 `PluginContext` API。

推荐把插件做成独立包，至少包含 `package.json`、`tsconfig.json` 和 `src/index.ts`。`package.json` 的入口指向构建后的 `dist/index.js`：

```json
{
    "name": "@yourscope/plugin-demo",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "devDependencies": {
        "@jsbot/core": "file:../.."
    },
    "dependencies": {
        "zod": "^4.6.7"
    }
}
```

`@jsbot/core` 只用于类型和 `definePlugin`，运行时由宿主提供。本地开发可以像上面一样用 `file:` 或 workspace 链接；发布到 npm 时不要把 `@jsbot/core` 写进 `dependencies` 或 `peerDependencies`，`file:` 开发依赖也可以直接删掉。仅在本机使用的包可以加 `"private": true`。插件自己的第三方依赖放在 `dependencies`，npm 安装插件时会一并安装。

内置插件 `core`、`admin` 是 `src/plugins/` 下的普通源码。其他插件放在 `local-plugins/`，该目录整体被 `.gitignore` 排除，并且有自己的本地 workspace 根：

```bash
npm install --prefix local-plugins
npm run build:local

node dist/app.js \
    --plugin-dir local-plugins/poke/dist \
    --plugin-dir local-plugins/llm/dist
```

示例见 [`examples/plugins/hello`](../examples/plugins/hello)。

## 通过 npm 发布与安装

发布到 npm registry 的插件包必须是可直接运行的构建产物，安装后不再执行编译。要求：

- ESM 包（`"type": "module"`），发布 `dist/` 中的 JavaScript 和 `.d.ts`。
- 通过 `exports["."]` 或 `main` 提供包根入口；安装器只解析根入口。
- 根入口导出插件定义：`export default plugin`、`export const plugin = ...` 或 `export const plugins = [...]`。
- `manifest.id` 必须匹配 `[a-z0-9][a-z0-9._-]*`，且不能与内置插件、`--plugin-dir` 插件或其它已安装插件重复。
- 插件之间的依赖写在 `manifest.dependencies`，依赖必须由同一个包导出，或已由其它已安装包提供。
- 不要依赖源码仓库或相对的 `file:` 依赖；第三方运行时依赖写入 `dependencies`。
- 不要把 `@jsbot/core` 写进 `dependencies` 或 `peerDependencies`。宿主会在安装目录创建 `node_modules/@jsbot/core` 链接，运行时直接解析到当前内核。
- 不要依赖 `postinstall` 构建。安装器默认使用 `--ignore-scripts`，只有 `installer.allowScripts=true` 才会执行 npm 脚本。

发布后在聊天中安装：

```text
/plugin install @yourscope/plugin-demo@1.0.0
/plugin install @yourscope/plugin-demo@latest
/plugin list
/plugin update @yourscope/plugin-demo
/plugin remove @yourscope/plugin-demo
```

安装、更新和卸载在重启后生效。安装器只接受 npm registry 包，拒绝 git、file、URL、workspace、link 和版本范围。安装目录默认是 `<data-dir>/plugins`，配置见[插件安装器](configuration.md#插件安装器)。

插件配置仍然写在 `bot.config.v2.json` 的 `plugins.<id>` 中。安装器不会自动修改配置；卸载时如果配置里仍保留对应 ID，命令会提示先删除，否则重启会因未知插件 ID 失败。
