# 配置

## 路径和优先级

| 项目     | CLI            | 环境变量         | 默认值                 |
| -------- | -------------- | ---------------- | ---------------------- |
| 配置文件 | `--config`     | `BOT_CONFIG`     | `./bot.config.v2.json` |
| 数据目录 | `--data-dir`   | `BOT_DATA_DIR`   | `./data-v2`            |
| 日志级别 | `--log-level`  | `BOT_LOG_LEVEL`  | `info`                 |
| 插件目录 | `--plugin-dir` | `BOT_PLUGIN_DIR` | 无                     |

`--plugin-dir` 可以重复；`BOT_PLUGIN_DIR` 使用逗号分隔多个目录。空字符串会被视为未设置。路径最终按 `process.cwd()` 解析。

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

`installer` 控制 `/plugin install`、`/plugin remove`、`/plugin update` 的行为。安装器默认开启，但所有写操作始终要求 SuperAdmin。

```json
{
    "installer": {
        "enabled": true,
        "dir": "data-v2/plugins",
        "registry": "https://registry.npmjs.org/",
        "allowedPackages": ["@scope/*", "another-plugin"],
        "allowScripts": false,
        "timeoutMs": 120000
    }
}
```

| 字段              | 默认值                        | 说明                                                |
| ----------------- | ----------------------------- | --------------------------------------------------- |
| `enabled`         | `true`                        | 为 `false` 时禁用安装、卸载和更新；列表仍可用       |
| `dir`             | `<data-dir>/plugins`          | 安装目录，相对路径按 `process.cwd()` 解析           |
| `registry`        | `https://registry.npmjs.org/` | npm registry，可换成镜像（如 npmmirror）            |
| `allowedPackages` | `[]`                          | 允许安装的包；空表示不限制，支持精确名和 `@scope/*` |
| `allowScripts`    | `false`                       | 为 `false` 时 npm 操作带 `--ignore-scripts`         |
| `timeoutMs`       | `120000`                      | 单次 npm/校验操作的超时，最大 600000                |

安装目录由内核维护，包含 `package.json`、`package-lock.json` 和 `.jsbot-installed.json`。不要手动修改；安装失败时内核会恢复安装前的 manifest/lock 并重装依赖。

安装器会在安装目录创建 `node_modules/@jsbot/core` 链接，指向当前内核包。`@jsbot/core` 的入口是 `dist/core/index.js`，所以在线安装和加载已安装插件都需要先执行 `npm run build`；直接从 TypeScript 源码运行（`tsx`）时不要依赖安装器。

安装只接受 npm registry 包。以下来源会被拒绝：git/github 地址、`file:`、`http(s):`、`workspace:`、`link:`、本地路径和 semver 范围（`^`、`~`、`1.x`）。版本部分只接受精确版本或 dist-tag。

安装、更新后需要重启进程才能加载新插件。启动时加载顺序是：内置插件 → `--plugin-dir` 外部插件 → 已安装插件；出现重复插件 ID 时保留先加载的插件并记录警告。

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

- `/utter <文本>`：Admin 权限，发送纯文本。
- `/utter.raw <CQ 消息>`：SuperAdmin 权限，发送原始 CQ 字符串。

## 外部与本地插件配置

`plugins` 中出现的插件 ID 必须对应已加载的插件，否则启动失败。外部插件通过 `--plugin-dir` 或 `BOT_PLUGIN_DIR` 加载：

```bash
node dist/app.js \
    --plugin-dir local-plugins/poke/dist \
    --plugin-dir local-plugins/llm/dist
```

通过 `/plugin install` 安装的包会自动从 `<data-dir>/plugins` 加载，不需要 `--plugin-dir`。安装目录、registry 和允许列表见[插件安装器](#插件安装器)。

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

内置插件 `core`、`admin` 是 `src/plugins/` 下的普通源码，随内核一起编译。其他插件放在 `local-plugins/`，整个目录被 `.gitignore` 排除。本地插件是独立的包，有自己的 `package.json`：

```bash
npm install --prefix local-plugins
npm run build:local

npm run dev -- \
    --plugin-dir local-plugins/poke/dist \
    --plugin-dir local-plugins/llm/dist
```

应用会跳过与内置插件同 ID 的外部插件。

## 错误处理

- 配置读取失败、JSON 解析失败、schema 校验失败都会在启动前退出。
- Zod 错误会带路径，例如 `plugins.demo.limit`。
- 未知插件 ID 会导致启动失败。
- 插件 `configSchema` 使用 `.strict()`，未知字段会报错。
