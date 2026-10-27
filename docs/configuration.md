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
| `plugins`     | object | `{}`                                      | 以插件 ID 为键的配置      |

顶层未知字段会导致启动失败。

`message.charThreshold` 按 CQ 字符串长度计算；`message.lineThreshold` 按换行后的行数计算。任一阈值超过都会把回复转成 forward 发送。

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
