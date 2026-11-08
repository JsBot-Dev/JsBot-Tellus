# 配置

## 路径和优先级

| 项目     | CLI           | 环境变量        | 默认值               |
| -------- | ------------- | --------------- | -------------------- |
| 配置文件 | `--config`    | `BOT_CONFIG`    | `./bot.config.jsonc` |
| 数据目录 | `--data-dir`  | `BOT_DATA_DIR`  | `./data`             |
| 日志级别 | `--log-level` | `BOT_LOG_LEVEL` | `info`               |

本地插件目录固定为 `./plugins`，不提供 CLI 或环境变量覆盖；每个插件从 `./plugins/<id>/dist` 加载，每次启动或重启加载时，带源码的插件会尝试自动重建，失败时回退已有产物，相对路径按 `process.cwd()` 解析。

主配置文件使用 JSONC，支持 `//`、`/* */` 注释和尾随逗号。默认读取 `./bot.config.jsonc`；如果该文件不存在但旧版 `./bot.config.json` 存在，会回退读取旧文件并输出警告，建议重命名为 `bot.config.jsonc`。显式通过 `--config` 或 `BOT_CONFIG` 指定的路径始终优先，且同样按 JSONC 解析。

## 完整示例

```jsonc
{
    "url": "ws://127.0.0.1:3001/",
    "accessToken": "0123456789abcdef",
    "roles": {
        "superadmin": [10001],
        "admin": [10002],
    },
    "permission": {
        "deniedMessage": "权限不足：需要 {required}，当前 {actual}",
    },
    "message": {
        "charThreshold": 50,
        "lineThreshold": 3,
    },
    "installer": {
        "enabled": true,
        "registry": "https://registry.npmjs.org/",
        "allowedPackages": [],
        "allowScripts": false,
        "timeoutMs": 120000,
    },
}
```

## 顶层字段

| 字段          | 类型   | 默认值                                    | 说明                      |
| ------------- | ------ | ----------------------------------------- | ------------------------- |
| `url`         | string | `ws://127.0.0.1:3001/`                    | WebSocket 地址，仅 ws/wss |
| `accessToken` | string | 无                                        | OneBot access token       |
| `roles`       | object | `{ superadmin: [], admin: [] }`           | 角色名单                  |
| `permission`  | object | 见[权限提示](#权限提示)                   | 权限不足时的提示          |
| `message`     | object | `{ charThreshold: 50, lineThreshold: 3 }` | 长消息转 forward 阈值     |
| `installer`   | object | 见下文                                    | npm 插件安装器            |

顶层未知字段会导致启动失败。插件配置不在 `bot.config.jsonc` 中，见[插件配置](#插件配置)。

`message.charThreshold` 按 CQ 字符串长度计算；`message.lineThreshold` 按换行后的行数计算。任一阈值超过都会把回复转成 forward 发送。

## 权限提示

`permission.deniedMessage` 控制命令权限不足时发送的提示，默认值为：

```json
{
    "permission": {
        "deniedMessage": "权限不足：需要 {required}，当前 {actual}"
    }
}
```

提示支持 `{required}` 和 `{actual}` 两个占位符，分别替换为命令要求的角色和用户当前角色。也可以写成不带占位符的固定文本；空字符串或超过 500 个字符会导致配置校验失败。

## 插件安装器

`installer` 控制 `/plugin install`、`/plugin check`、`/plugin remove`、`/plugin update` 的行为。安装器默认关闭，需要显式设置 `enabled: true`；启用后 `/plugin` 的所有子命令（包括 `help` 和 `list`）都要求 SuperAdmin。

npm 包会在宿主进程中执行，拥有与内核相同的文件系统、环境变量和网络权限。只安装完全信任的包；`allowedPackages` 为空表示不限制包名，建议在生产环境配置 allowlist。

```json
{
    "installer": {
        "enabled": true,
        "registry": "https://registry.npmjs.org/",
        "allowedPackages": ["@scope/*", "another-plugin"],
        "allowScripts": false,
        "timeoutMs": 120000
    }
}
```

| 字段              | 默认值                        | 说明                                                               |
| ----------------- | ----------------------------- | ------------------------------------------------------------------ |
| `enabled`         | `false`                       | 为 `false` 时禁用安装、卸载和更新；列表仍可用（仍要求 SuperAdmin） |
| `registry`        | `https://registry.npmjs.org/` | npm registry，可换成镜像（如 npmmirror）                           |
| `allowedPackages` | `[]`                          | 允许安装的包；空表示不限制，支持精确名和 `@scope/*`                |
| `allowScripts`    | `false`                       | 为 `false` 时 npm 操作带 `--ignore-scripts`                        |
| `timeoutMs`       | `120000`                      | 单次 npm/校验操作的超时，最大 600000                               |

插件根目录固定为 `plugins/`，不能通过配置修改；旧配置中的 `installer.dir` 已被移除，继续保留会导致配置校验失败。安装器把包直接放到 `plugins/<插件id>/`，和本地插件使用同一个加载器；首次安装时，一个包导出多个插件会使用包名作为目录（例如 `@scope/bundle` 对应 `plugins/@scope__bundle/`）。插件自身在 `plugins/<目录>/dist`，运行时依赖在 `plugins/<目录>/node_modules`，不会放进共享的 `node_modules`。

`plugins/.jsbot-installed.json` 保存安装状态和包名到目录的映射，由内核维护，不要手动修改。安装、更新会先在临时目录完成下载和校验，再原子替换目标目录；失败时保留原目录。状态文件损坏会明确报错，不会静默清空。如果目标目录已存在但没有安装记录，安装会被拒绝，避免覆盖手动放在 `plugins/` 的本地插件。

安装器会在每个已安装插件目录创建 `node_modules/@jsbot-tellus/core` 链接，指向当前内核包。`@jsbot-tellus/core` 的入口是 `dist/core/index.js`，所以在线安装和加载已安装插件都需要先执行 `npm run build`；直接从 TypeScript 源码运行（`tsx`）时不要依赖安装器。

安装只接受 npm registry 包。以下来源会被拒绝：git/github 地址、`file:`、`http(s):`、`workspace:`、`link:`、本地路径和 semver 范围（`^`、`~`、`1.x`）。版本部分只接受精确版本或 dist-tag。

安装、更新、卸载成功后会自动重建运行时并重新加载插件，不需要手动重启，进程本身不会退出。卸载时如果对应的插件配置文件仍然存在，会给出警告并跳过自动重启；残留文件本身只会被忽略，建议手动删除。如果其它已安装包依赖被卸载的插件 ID，默认拒绝卸载，需要确认后使用 `/plugin remove <目标> --force`。安装和更新会检查完整依赖图，拒绝自依赖、循环依赖和缺失依赖。启动时把内置插件和 `plugins/` 中的全部目录一起加载；出现重复插件 ID 时保留先加载的插件并记录警告。

## 插件配置

每个插件使用一个独立的 JSONC 文件，位置为 `<data-dir>/config/plugin/<id>.jsonc`（数据目录默认是 `./data`）。文件名是插件 ID 经过 URL 编码后的结果；普通 ID 直接使用 `<id>.jsonc`。文件内容是插件的完整配置，包括公共信封字段和插件自己的选项：

```jsonc
{
    // 公共信封字段
    "enabled": true,
    "private": true,
    "groups": {
        "allow": [111, 222],
        "deny": [],
    },

    // 插件自己的选项
    "limit": 20,
}
```

JSONC 支持 `//`、`/* */` 注释和尾随逗号。WebUI 保存时会写成标准 JSON，手写注释会被丢弃。

| 字段      | 默认值            | 说明                              |
| --------- | ----------------- | --------------------------------- |
| `enabled` | manifest 的默认值 | `core`、`admin` 默认开启          |
| `private` | `true`            | 私聊是否启用                      |
| `groups`  | 无限制            | 只作用于带 `group_id` 的事件      |
| `allow`   | `[]`              | 非空时只有列表中的群可用          |
| `deny`    | `[]`              | 非空时列表中的群不可用            |
| 其他字段  | 无                | 原样传给插件自己的 `configSchema` |

`allow` 和 `deny` 不能同时非空。群配置优先于 `private`，不会影响私聊。

### 加载与错误处理

- 文件不存在或为空：先尝试用 `configSchema` 的默认值加载；如果 schema 仍要求必填项，记录警告并跳过该插件。
- JSONC 解析失败、顶层不是对象、公共信封校验失败或插件 `configSchema` 校验失败：记录警告并跳过该插件。
- 配置文件名对应的插件 ID 未加载（拼写错误、插件已卸载等）：记录警告并忽略该文件。
- 插件配置问题不会阻止 Kernel 启动；`bot.config.jsonc` 本身的读取、JSONC 解析和 schema 校验错误仍会阻止启动。
- 非 `.jsonc` 文件、以 `.` 开头的隐藏文件和 `.bak` 文件不会被扫描。

`bot.config.jsonc` 中的旧 `plugins` 字段会被忽略并记录警告，不再阻止启动；WebUI 保存配置时会自动移除该字段。本版本不会自动迁移旧配置，建议手动把每个插件配置移动到 `config/plugin/<id>.jsonc`。迁移方法见[迁移与回滚](migration.md#30-插件配置迁移)。

## 内置插件配置

内置插件同样使用独立文件。

### core

`<data-dir>/config/plugin/core.jsonc`：

```jsonc
{
    "enabled": true,
}
```

提供 `/help`、`/status`、`/role` 和只读的 `ctx.core` 服务。

### admin

`<data-dir>/config/plugin/admin.jsonc`：

```jsonc
{
    "enabled": true,
}
```

- `/utter <文本>`：Admin 权限，发送自动转义的纯文本（CQ 码不会被解析）。
- `/utter raw <CQ 消息>`：SuperAdmin 权限，发送原始 CQ 字符串。

## 插件目录配置

插件配置文件按 ID 对应已加载的插件；未加载的插件 ID 只会记录警告并忽略该文件。本地插件和在线安装的插件都固定从 `plugins/<目录>/dist` 自动加载：

```bash
npm run build
node dist/app.js
```

带有 `build` 脚本、依赖已安装且包含源码（`tsconfig.json` 或 `src/`）的插件，无论 `dist` 是否已经存在，每次加载都会先自动执行 `npm run build`；只有 `dist` 的预编译包直接加载。构建失败或缺少 `node_modules` 时会回退加载已有 `dist`，没有可用 `dist` 时记录警告并跳过。没有 `build` 脚本的插件直接加载现有 `dist`。通过 `/plugin install` 安装的包通常只包含 `dist`，会直接使用自带产物，不尝试重建。安装状态、registry 和允许列表见[插件安装器](#插件安装器)。

插件自己的配置字段由 `manifest.configSchema` 校验。例如一个 `demo` 插件，配置写在 `<data-dir>/config/plugin/demo.jsonc`：

```jsonc
{
    "enabled": true,
    "private": false,
    "limit": 20,
}
```

`enabled`、`private`、`groups` 由内核处理；`limit` 会传给 `demo` 的 `configSchema`。未知字段会导致该插件被跳过，警告信息包含 `demo.limit` 这样的路径。

内置插件 `core`、`admin` 是 `src/plugins/` 下的普通源码，随内核一起编译。其他插件放在 `plugins/`，整个目录被 `.gitignore` 排除。每个本地插件都是独立包，有自己的 `package.json` 和依赖：

```bash
npm install --prefix plugins/poke
npm install --prefix plugins/llm
npm run build:plugin

npm run dev
```

本地插件从 `plugins/<id>/dist` 自动加载；带源码的插件每次加载前都会尝试重建。应用会跳过与内置插件同 ID 的本地插件。

## 错误处理

- `bot.config.jsonc` 读取失败、JSONC 解析失败或 schema 校验失败都会在启动前退出；旧 `plugins` 字段只记录警告并忽略。
- 插件配置文件缺失或为空时先尝试使用 schema 默认值；JSONC 解析失败、公共信封无效或插件 `configSchema` 校验失败时，记录警告并跳过该插件。两种情况都不会阻止 Kernel 启动。
- 未加载的插件 ID 对应的配置文件只会记录警告并被忽略。
- Zod 错误会带路径，例如 `demo.limit`。
- 插件 `configSchema` 通常使用 `.strict()`，未知字段会被视为错误并跳过该插件。
- WebUI 保存插件配置时仍然严格校验，非法配置返回 400，不会写入文件。
