# 插件 API

## 入口

```ts
import { definePlugin } from '@jsbot-tellus/core'
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
| `dependencies`   | 依赖的插件 ID；只保证排序，不保证依赖已启用        |
| `priority`       | 越大越先执行；依赖关系优先于 priority              |
| `defaultEnabled` | 配置没有写 `enabled` 时的默认值，默认 `false`      |
| `configSchema`   | Zod schema，只校验插件自己的配置                   |

公共信封字段 `enabled`、`private`、`groups` 由内核处理，不会传给 `configSchema`。

`dependencies` 参与全局排序和循环检测；被依赖的插件即使配置为 `enabled: false` 也不会执行 `setup` 或 `start`。需要运行时能力时，请自行检查依赖插件是否已加载，或确保它在配置中启用。

## 生命周期

```ts
export default definePlugin({
    manifest: { id: 'demo', version: '1.0.0', configSchema: z.object({}) },

    async setup(ctx) {
        ctx.commands.register({ name: 'demo' }, async (_event, context) => {
            await context.send('hello')
        })

        return {
            timer: undefined as ReturnType<typeof setInterval> | undefined,
        }
    },

    async start(state) {
        // 连接已经建立，可以调用 ctx.api
        state.timer = setInterval(() => {}, 1000)
    },

    async stop(state) {
        if (state.timer) clearInterval(state.timer)
    },
})
```

- `setup(ctx)`：同步或异步；只注册命令、事件和中间件。返回的 state 会传给 `start`/`stop`。
- `start(state)`：在 client 连接成功后调用；需要清理的运行时资源应在这里创建。
- `stop(state)`：只对成功完成 `start` 的插件逆序调用；必须幂等，异常会被记录但不会阻断关闭。

`setup` 失败时内核会移除该插件已经注册的能力，但不会调用 `stop`，因此不要在 `setup` 中分配需要清理的外部资源。插件排序失败、依赖缺失、循环依赖、ID 重复都会导致启动失败。

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
const visibleCommands = ctx.core.commands.list(event)
const plugins = ctx.core.plugins.list()
const uptime = ctx.core.uptime()

const installed = await ctx.core.installer.list()
ctx.core.restart()
```

核心服务由内核注入，适合帮助、状态类插件。`ctx.core.commands.list(event)` 会按当前会话的 `enabled`、`groups`、`private` gating 过滤命令；不传 `event` 时返回全部命令。`ctx.core.installer` 额外提供 `install` / `remove` / `update` / `list`；它不会检查调用者角色，权限判断由调用方负责（`admin` 的 `/plugin` 命令要求 SuperAdmin）。安装器默认关闭，必须在配置中显式启用。`ctx.core.restart()` 请求应用重建运行时并重新加载插件；第三方插件不应把这些方法暴露给普通用户。

安装的插件与内置插件运行在同一个宿主进程中，可访问文件系统、网络和 `process.env`，属于完全可信代码，不是安全沙箱。

自动重启会在同一个 Node.js 进程内重建 Kernel，不会清空 Node 的 ESM 模块缓存。安装包的入口文件会附加查询参数来绕过缓存，但入口相对导入的辅助模块仍可能复用旧代码；通过 `plugins/` 加载的本地插件也不会被缓存刷新。更新多文件插件包后，请完整退出并重新启动进程。

## 命令

### 普通命令

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

| 字段          | 默认值   | 说明                                         |
| ------------- | -------- | -------------------------------------------- |
| `name`        | 必填     | 主命令名，匹配时大小写不敏感                 |
| `aliases`     | `[]`     | 别名                                         |
| `prefixes`    | `['/']`  | 前缀；空字符串表示无前缀                     |
| `permission`  | `'User'` | `User`、`Admin`、`SuperAdmin`                |
| `description` | 无       | `/help` 中展示                               |
| `params`      | 无       | Koishi 风格参数声明；省略时 handler 行为不变 |

`name` 和 `aliases` 的每一项只能是一个路径段；多级命令请使用 `commands.group()`。

### 参数

`params` 用字符串声明位置参数，解析结果从 handler 的第四个参数开始按位置传入：

```ts
ctx.commands.register(
    {
        name: 'ask',
        description: '向模型提问',
        params: '<question:string> [count:integer=1]',
    },
    async (_event, context, _match, question, count) => {
        // question: string, count: number
        await context.send(`问题：${question}（${count} 次）`)
    }
)
```

声明语法：

| 写法                  | 说明                                     |
| --------------------- | ---------------------------------------- |
| `<arg>`               | 必填字符串参数                           |
| `[arg]`               | 可选字符串参数                           |
| `<arg:type>`          | 指定类型的必填参数                       |
| `[arg:type=default]`  | 可选参数及默认值                         |
| `<arg:string(2..10)>` | 带长度限制的字符串参数                   |
| `<arg:text>`          | 文本参数，消费全部剩余输入，必须放在最后 |
| `[...rest]`           | 变长参数，每个剩余 token 作为一个字符串  |

内置类型：

- `string`：默认类型，单个 token。
- `text`：消费全部剩余输入，保留空格；usage 显示为 `<arg...>`。
- `number`：有限数字，包括小数。
- `integer`：整数。
- `boolean`：`true/false`、`1/0`、`yes/no`、`y/n`、`on/off`，大小写不敏感。
- `time`：时间长度，解析为秒数。支持纯数字（秒）和单位 `s/m/h/d/w` 或中文 `秒/分/分钟/时/小时/天/周`，可以组合，例如 `60`、`10s`、`5m`、`1h30m`、`1d`、`1小时30分钟`；支持 `1.5h` 这类小数单位，但总秒数必须是整数。可以声明默认值。
- `at`：@ 提及或 QQ 号，解析为数字。支持 `[CQ:at,qq=123456]`（可带 `name` 等附加参数）和纯数字 `123456`；`@全体成员` 和普通文本会报类型错误，且不能声明默认值。
- `reply`：当前消息引用（回复）的消息 ID，解析为数字。该参数不消费命令文本，而是从事件中的 `reply` 分段读取；未引用消息时必填参数会报错，且不能声明默认值。引用消息发送命令时，`raw_message` 开头的 `[CQ:reply,...]` 会被忽略，命令仍能正常匹配。
- `[...rest]`：把剩余 token 依次收集为字符串；只能放在最后，且没有必填形式。

`string` 和 `text` 可以在类型后追加长度限制，按 Unicode 码点计数，区间两端都包含：

```ts
params: '<message:text(2..200)> [nickname:string(..16)]'
```

- `(..10)`：最多 10 个字符。
- `(2..)`：至少 2 个字符。
- `(2..10)`：2 到 10 个字符。
- 只能用于 `string` / `text`；其他类型和 `[...rest]` 会报声明错误。
- 默认值也会在注册时校验；usage 不会显示长度限制。

固定参数可以用双引号或单引号包裹，例如 `/ask "hello world" 2` 会把 `hello world` 作为一个 token；引号内的反斜杠用于转义。

解析规则：

- `match.args` 和 `match.rest` 保持原始内容，不会被参数解析结果替换。
- 声明槽位填完后，多余 token 会被忽略并记录 debug 日志，不会报错。`text` 和 `rest` 会消费全部剩余输入，因此不存在多余 token。
- 必填参数缺失、已声明槽位类型错误、长度不符合限制或引号未闭合时，Router 会自动回复错误和用法，handler 不会执行。
- usage 会自动生成，并显示在 `/help` 和指令组根命令的用法提示中。
- 必填参数不能出现在可选参数之后；参数名不能重复；`text` 和变长参数必须放在最后；必填参数不能声明默认值；长度限制只能用于 `string` / `text`，上下限必须是非负整数且下限不能大于上限。
- 当 `params` 是字符串字面量时，handler 从第四个参数开始的位置参数类型会自动推导。例如 `<question:string> [count:integer=1]` 会推导为 `(question: string, count: number)`，`[name:string]` 会推导为 `string | undefined`，`[...rest]` 会推导为 `...string[]`。
- 需要在类型位置复用推导结果时，可以使用导出的 `CommandParamArgs<'<question:string>'>`。
- 也可以继续手写 handler 参数注解；注解与声明不一致时会在编译期报错。
- 自动推导只对字面量生效：运行时拼接的字符串，或显式声明为 `string` 的变量会回退为 `any[]`。需要保留字面量类型时，使用 `const` 变量或 `as const`。
- 类型层解析覆盖上面的声明语法；如果默认值包含 `]` 等会干扰声明边界的字符，可能回退为 `any[]`，但不影响运行时解析。非法声明仍然在注册时抛错，而不是变成类型错误。

参数错误示例：

```text
/ask hello abc
-> 参数 count 需要是整数
-> 用法：/ask <question> [count]
```

### 指令组

```ts
ctx.commands.group(
    {
        name: 'plugin',
        aliases: ['p'],
        permission: 'SuperAdmin',
        description: '管理已安装的插件包',
        // 可选；省略时自动生成用法提示
        handler: async (_event, context) => {
            await context.send('用法：/plugin <list|install>')
        },
    },
    (plugin) => {
        plugin.register(
            {
                name: 'list',
                description: '列出插件包',
            },
            async (_event, context) => {
                await context.send('...')
            }
        )

        plugin.register(
            {
                name: 'install',
                description: '安装插件包',
                params: '<spec:string>',
            },
            async (_event, context, _match, spec: string) => {
                await context.send(`安装：${spec}`)
            }
        )

        plugin.group({ name: 'cache' }, (cache) => {
            cache.register({ name: 'clear' }, async () => {})
        })
    }
)
```

指令组规则：

- `group()` 的 `name` 和 `aliases` 同样是单个路径段；通过嵌套 `group()` 组成任意层级。
- 子命令自动拼接组路径，例如上面的 `plugin` + `install` 对应 `/plugin install`。
- 子命令默认继承组的 `prefixes`、`permission`，也可以在子命令上覆盖。
- 组别名和子命令别名会自动组合；组 `plugin` 别名 `p`、子命令 `install` 别名 `i` 时，`/p i` 也能命中。
- 组根没有提供 `handler` 时，会自动注册根命令并生成用法提示，列出直接子命令、参数用法和描述。
- 组根提供了 `handler` 时，未命中子命令的输入（例如 `/plugin`、`/plugin help`、`/plugin unknown`）会进入该 handler。
- 组根和子命令都可以声明 `params`；子命令的用法会显示在组根提示和 `/help` 中。例如组根声明 `params: '<target:string>'` 时，`/demo alice` 会把 `alice` 传给组根 handler。
- `group()` 返回 disposer，会注销组根和所有子命令；组 setup 抛错或注册冲突时会自动回滚整组。
- `/help` 中会显示完整路径，例如 `/plugin install`。

同一前缀下按完整路径进行冲突检测。命令命中后会立即 `stopPropagation()`。

匹配时前缀最长优先，同一前缀下完整路径最长优先：

```text
/plugin install demo
-> command: "plugin install"
-> args: ["demo"]
-> rest: "demo"
```

`/plugin unknown` 在 `plugin` 组根存在时会回退到组根，`args` 为 `["unknown"]`。

`CommandMatch`：

```ts
interface CommandMatch {
    command: string // 命中的完整路径，例如 "plugin install"
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
await context.send('自动转义 CQ 码', { autoEscape: true })
```

`EventContext.send` 的行为：

- 短消息默认通过 SDK `quote` 添加 `[CQ:reply]` 引用原消息。
- `quote: false` 时直接发到群或私聊。
- 字符串默认按原始 CQ 码发送（`autoEscape` 默认 `false`）；发送用户输入时请显式传 `autoEscape: true`。
- 超过 `message.charThreshold` 或 `lineThreshold` 时转为 forward，forward 不保留引用。
- 发送失败会写日志并向调用方抛出。

## 权限与 gating

- `User` < `Admin` < `SuperAdmin`。
- `roles.superadmin` 和 `roles.admin` 在配置中维护。
- 用户权限不足时，命令不会执行，并回复一条通用提示。
- `plugins.<id>.enabled` 控制整体启用。
- `plugins.<id>.groups.allow` / `deny` 只作用于群事件，二者不能同时非空。
- `plugins.<id>.private` 控制私聊，默认 `true`。
- `/help` 只列出当前会话中启用的插件命令；群 gating 或 `private: false` 会隐藏对应命令。

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

## 本地插件

完整的目录约定、创建步骤和本地调试流程见[插件开发指南](plugin-development.md)。

本地插件固定放在 `plugins/<id>/dist`，应用启动时自动扫描，不需要路径参数：

```bash
npm run build
node dist/app.js
```

应用会跳过与内置插件同 ID 的本地插件。加载器会扫描每个插件 `dist` 目录下所有 `.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.cts` 文件，识别：

- `export default plugin`
- `export const plugin = ...`
- `export const plugins = [...]`

没有导出插件定义的 helper 模块会被跳过；空目录不会报错，但目录中存在无法导入或无法识别的文件、且最终没有加载到任何有效插件时，启动失败。插件定义必须包含可调用的 `configSchema.safeParse`，非法的 `dependencies` 类型也会被拒绝。

TypeScript 插件必须在生产运行前编译为 JavaScript。本地插件和内置插件共用同一个 `PluginContext` API。

推荐把插件做成独立包，至少包含 `package.json`、`tsconfig.json` 和 `src/index.ts`。`package.json` 的入口指向构建后的 `dist/index.js`：

```json
{
    "name": "@yourscope/plugin-demo",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "devDependencies": {
        "@jsbot-tellus/core": "^2.0.2"
    },
    "dependencies": {
        "zod": "^4.6.7"
    }
}
```

`@jsbot-tellus/core` 只用于类型和 `definePlugin`。通过 `/plugin install` 安装时由宿主提供；从 `plugins/` 加载的本地插件需要在插件自己的 `node_modules` 中安装 core（`npm install` 会安装 `devDependencies`）。在本仓库内联调也可以改用 `file:` 或 workspace 链接。发布到 npm 时不要把 `@jsbot-tellus/core` 写进 `dependencies` 或 `peerDependencies`。仅在本机使用的包可以加 `"private": true`。插件自己的第三方依赖放在 `dependencies`，npm 安装插件时会一并安装。

内置插件 `core`、`admin` 是 `src/plugins/` 下的普通源码。其他插件放在 `plugins/`，该目录整体被 `.gitignore` 排除。每个本地插件都是独立包，独立安装依赖：

```bash
npm install --prefix plugins/poke
npm install --prefix plugins/llm
npm run build:plugin

node dist/app.js
```

应用会自动扫描 `plugins/<id>/dist`；没有 `dist` 的本地插件如果带有 `build` 脚本且依赖已安装，会先自动构建再加载，构建失败则记录警告并跳过。示例见 [`examples/plugins/hello`](../examples/plugins/hello)。

## 通过 npm 发布与安装

打包结构、发布清单和本地开发流程见[插件开发指南](plugin-development.md)。

发布到 npm registry 的插件包必须是可直接运行的构建产物，安装后不再执行编译。要求：

- ESM 包（`"type": "module"`），发布 `dist/` 中的 JavaScript 和 `.d.ts`；安装后从 `plugins/<目录>/dist` 加载，不再执行编译。
- `dist/` 中导出的插件定义会被加载：`export default plugin`、`export const plugin = ...` 或 `export const plugins = [...]`。
- `manifest.id` 必须匹配 `[a-z0-9][a-z0-9._-]*`，且不能与内置插件、`plugins/` 本地插件或其它已安装插件重复。
- 插件之间的依赖写在 `manifest.dependencies`，依赖必须由同一个包导出，或已由其它已安装包提供。
- 不要依赖源码仓库或相对的 `file:` 依赖；第三方运行时依赖写入 `dependencies`。
- 不要把 `@jsbot-tellus/core` 写进 `dependencies` 或 `peerDependencies`。宿主会在 `plugins/<目录>/node_modules/@jsbot-tellus/core` 创建链接，运行时直接解析到当前内核。
- 不要依赖 `postinstall` 构建。安装器默认使用 `--ignore-scripts`，只有 `installer.allowScripts=true` 才会执行 npm 脚本。

发布后在聊天中安装：

```text
/plugin install @yourscope/plugin-demo@1.0.0
/plugin install @yourscope/plugin-demo@latest
/plugin list
/plugin update @yourscope/plugin-demo
/plugin remove @yourscope/plugin-demo
```

安装、更新和卸载成功后会自动重启运行时并重新加载插件，进程不会退出。`/plugin` 的所有子命令（包括 `help` 和 `list`）都要求 SuperAdmin。安装器默认关闭；启用后只接受 npm registry 包，拒绝 git、file、URL、workspace、link 和版本范围。包会直接安装到 `plugins/<插件id>/` 并从 `dist` 加载，配置见[插件安装器](configuration.md#插件安装器)。

安装和更新会检查完整依赖图；自依赖、循环依赖和缺失依赖会被拒绝。卸载被其它包依赖的插件时默认失败，确认后可使用 `/plugin remove <目标> --force`。

插件配置仍然写在 `bot.config.json` 的 `plugins.<id>` 中。安装器不会自动修改配置；卸载时如果配置里仍保留对应 ID，命令会提示先删除，否则重启会因未知插件 ID 失败。
