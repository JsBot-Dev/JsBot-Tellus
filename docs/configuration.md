# 配置

## 路径和优先级

| 项目     | CLI           | 环境变量        | 默认值              |
| -------- | ------------- | --------------- | ------------------- |
| 配置文件 | `--config`    | `BOT_CONFIG`    | `./bot.config.json` |
| 数据目录 | `--data-dir`  | `BOT_DATA_DIR`  | `./data`            |
| 日志级别 | `--log-level` | `BOT_LOG_LEVEL` | `info`              |

本地插件目录固定为 `./plugins`，不提供 CLI 或环境变量覆盖；每个插件从 `./plugins/<id>/dist` 加载，相对路径按 `process.cwd()` 解析。

## 完整示例

```json
{
    "url": "ws://127.0.0.1:3001/",
    "accessToken": "0123456789abcdef",
    "roles": {
        "superadmin": [10001],
        "admin": [10002]
    },
    "message": {
        "charThreshold": 50,
        "lineThreshold": 3
    },
    "installer": {
        "enabled": true,
        "registry": "https://registry.npmjs.org/",
        "allowedPackages": [],
        "allowScripts": false,
        "timeoutMs": 120000
    },
    "plugins": {
        "core": {
            "enabled": true
        },
        "admin": {
            "enabled": true
        }
    }
}
```

## 顶层字段

| 字段          | 类型   | 默认值                                    | 说明                      |
| ------------- | ------ | ----------------------------------------- | ------------------------- |
| `url`         | string | `ws://127.0.0.1:3001/`                    | WebSocket 地址，仅 ws/wss |
| `accessToken` | string | 无                                        | OneBot access token       |
| `roles`       | object | `{ superadmin: [], admin: [] }`           | 角色名单                  |
| `message`     | object | `{ charThreshold: 50, lineThreshold: 3 }` | 长消息转 forward 阈值     |
| `installer`   | object | 见下文                                    | npm 插件安装器            |
| `plugins`     | object | `{}`                                      | 以插件 ID 为键的配置      |

顶层未知字段会导致启动失败。

`message.charThreshold` 按 CQ 字符串长度计算；`message.lineThreshold` 按换行后的行数计算。任一阈值超过都会把回复转成 forward 发送。

## 插件安装器

`installer` 控制 `/plugin install`、`/plugin remove`、`/plugin update` 的行为。安装器默认关闭，需要显式设置 `enabled: true`；启用后 `/plugin` 的所有子命令（包括 `help` 和 `list`）都要求 SuperAdmin。

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

安装、更新、卸载成功后会自动重建运行时并重新加载插件，不需要手动重启，进程本身不会退出。卸载时如果配置里仍有对应插件 ID，会给出警告并跳过自动重启；如果其它已安装包依赖被卸载的插件 ID，默认拒绝卸载，需要确认后使用 `/plugin remove <目标> --force`。安装和更新会检查完整依赖图，拒绝自依赖、循环依赖和缺失依赖。启动时把内置插件和 `plugins/` 中的全部目录一起加载；出现重复插件 ID 时保留先加载的插件并记录警告。

## 插件公共信封

每个插件配置都支持：

```json
{
    "enabled": true,
    "private": true,
    "groups": {
        "allow": [111, 222],
        "deny": []
    }
}
```

| 字段      | 默认值            | 说明                              |
| --------- | ----------------- | --------------------------------- |
| `enabled` | manifest 的默认值 | `core`、`admin` 默认开启          |
| `private` | `true`            | 私聊是否启用                      |
| `groups`  | 无限制            | 只作用于带 `group_id` 的事件      |
| `allow`   | `[]`              | 非空时只有列表中的群可用          |
| `deny`    | `[]`              | 非空时列表中的群不可用            |
| 其他字段  | 无                | 原样传给插件自己的 `configSchema` |

`allow` 和 `deny` 不能同时非空。群配置优先于 `private`，不会影响私聊。

## 内置插件配置

### core

```json
{
    "enabled": true
}
```

提供 `/help`、`/status`、`/role` 和只读的 `ctx.core` 服务。

### admin

```json
{
    "enabled": true
}
```

- `/utter <文本>`：Admin 权限，发送自动转义的纯文本（CQ 码不会被解析）。
- `/utter raw <CQ 消息>`：SuperAdmin 权限，发送原始 CQ 字符串。

## 插件目录配置

`plugins` 中出现的插件 ID 必须对应已加载的插件，否则启动失败。本地插件和在线安装的插件都固定从 `plugins/<目录>/dist` 自动加载：

```bash
npm run build
node dist/app.js
```

没有 `dist` 的插件目录会被跳过并记录警告。通过 `/plugin install` 安装的包会直接出现在 `plugins/<插件id>/`，与手动放在 `plugins/` 的本地插件没有区别。安装状态、registry 和允许列表见[插件安装器](#插件安装器)。

插件自己的配置字段由 `manifest.configSchema` 校验。例如一个 `demo` 插件：

```json
{
    "plugins": {
        "demo": {
            "enabled": true,
            "private": false,
            "limit": 20
        }
    }
}
```

`enabled`、`private`、`groups` 由内核处理；`limit` 会传给 `demo` 的 `configSchema`。未知字段会报错，错误信息包含 `plugins.demo.limit` 这样的路径。

内置插件 `core`、`admin` 是 `src/plugins/` 下的普通源码，随内核一起编译。其他插件放在 `plugins/`，整个目录被 `.gitignore` 排除。每个本地插件都是独立包，有自己的 `package.json` 和依赖：

```bash
npm install --prefix plugins/poke
npm install --prefix plugins/llm
npm run build:local

npm run dev
```

本地插件从 `plugins/<id>/dist` 自动加载；应用会跳过与内置插件同 ID 的本地插件。

## 错误处理

- 配置读取失败、JSON 解析失败、schema 校验失败都会在启动前退出。
- Zod 错误会带路径，例如 `plugins.demo.limit`。
- 未知插件 ID 会导致启动失败。
- 插件 `configSchema` 使用 `.strict()`，未知字段会报错。
