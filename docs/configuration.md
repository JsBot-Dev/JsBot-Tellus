# 配置

## 路径和优先级

| 项目     | CLI            | 环境变量         | 默认值                 |
| -------- | -------------- | ---------------- | ---------------------- |
| 配置文件 | `--config`     | `BOT_CONFIG`     | `./bot.config.v2.json` |
| 数据目录 | `--data-dir`   | `BOT_DATA_DIR`   | `./data-v2`            |
| 日志级别 | `--log-level`  | `BOT_LOG_LEVEL`  | `info`                 |
| 插件目录 | `--plugin-dir` | `BOT_PLUGIN_DIR` | 无                     |

空字符串会被视为未设置。路径最终按 `process.cwd()` 解析。

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
        },
        "poke": {
            "enabled": true,
            "cooldownMs": 3000,
            "reply": "你戳我干嘛"
        },
        "llm": {
            "enabled": false,
            "private": true,
            "groups": {
                "allow": [987654321]
            },
            "contextSize": 50,
            "rateLimitMs": 3000,
            "api": "chat-completions",
            "provider": "example",
            "model": "your-model",
            "persona": "default",
            "personas": {
                "default": "你是一个简洁的中文助手。"
            },
            "providers": {
                "example": {
                    "base": "https://api.example.com/v1",
                    "apikey": "sk-...",
                    "model": "your-model"
                }
            }
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

| 字段      | 默认值            | 说明                                       |
| --------- | ----------------- | ------------------------------------------ |
| `enabled` | manifest 的默认值 | `core/admin/poke` 默认开启，`llm` 默认关闭 |
| `private` | `true`            | 私聊是否启用                               |
| `groups`  | 无限制            | 只作用于带 `group_id` 的事件               |
| `allow`   | `[]`              | 非空时只有列表中的群可用                   |
| `deny`    | `[]`              | 非空时列表中的群不可用                     |
| 其他字段  | 无                | 原样传给插件自己的 `configSchema`          |

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

### poke

```json
{
    "enabled": true,
    "cooldownMs": 3000,
    "reply": "你戳我干嘛"
}
```

| 字段         | 默认值       | 说明                          |
| ------------ | ------------ | ----------------------------- |
| `cooldownMs` | `3000`       | 同一群/私聊同一用户的冷却时间 |
| `reply`      | `你戳我干嘛` | 回复文本                      |

### llm

```json
{
    "enabled": false,
    "private": true,
    "contextSize": 50,
    "rateLimitMs": 3000,
    "api": "chat-completions",
    "provider": "example",
    "model": "your-model",
    "persona": "default",
    "personas": {
        "default": "你是一个简洁的中文助手。"
    },
    "providers": {
        "example": {
            "base": "https://api.example.com/v1",
            "apikey": "sk-...",
            "model": "your-model"
        }
    }
}
```

| 字段              | 默认值             | 说明                                                  |
| ----------------- | ------------------ | ----------------------------------------------------- |
| `contextSize`     | `50`               | 保留的上下文轮数；实际裁剪为 `contextSize * 2` 条消息 |
| `rateLimitMs`     | `3000`             | 同一 session 的最小请求间隔                           |
| `api`             | `chat-completions` | `chat-completions` 或 `responses`                     |
| `provider`        | 无                 | 默认 provider 名称                                    |
| `model`           | 无                 | 全局模型覆盖                                          |
| `persona`         | 无                 | 默认 persona 名称或直接文本                           |
| `personas`        | `{}`               | persona 名称到系统提示词的映射                        |
| `providers`       | `{}`               | provider 名称到连接配置的映射                         |
| `maxOutputTokens` | 无                 | 最大输出 token                                        |
| `temperature`     | 无                 | `0` 到 `2`                                            |
| `splitThreshold`  | `300`              | 单条回复的最大长度，超出后分段                        |

Provider：

| 字段     | 必填 | 说明                        |
| -------- | ---- | --------------------------- |
| `base`   | 是   | OpenAI 兼容 API 的 base URL |
| `apikey` | 是   | API key                     |
| `model`  | 否   | provider 级默认模型         |

解析顺序：

```text
provider = session.provider ?? config.provider
model    = session.model ?? config.model ?? provider.model
persona  = session.persona ?? config.persona
```

如果 persona 值能在 `personas` 中找到，使用对应系统提示词；否则直接作为系统提示词。

### LLM 命令

| 命令                   | 权限       | 说明                                                   |
| ---------------------- | ---------- | ------------------------------------------------------ |
| `/provider`            | SuperAdmin | 列出 provider，标记当前项                              |
| `/provider <名称>`     | SuperAdmin | 切换当前 session 的 provider；切换时清空 session model |
| `/model`               | SuperAdmin | 通过 provider 的 models 接口列出模型                   |
| `/model <模型 ID>`     | SuperAdmin | 设置当前 session 模型                                  |
| `/persona`             | SuperAdmin | 列出 persona                                           |
| `/persona <名称/文本>` | SuperAdmin | 设置当前 session persona                               |
| `/persona off`         | SuperAdmin | 清除当前 session persona                               |

这些命令只修改当前会话，不会写回配置文件。

### 触发规则

- 群消息必须 @ 机器人。
- 私聊消息直接触发，但受 `private` 开关控制。
- 机器人自己的消息不会触发。
- 同一 session 受 `rateLimitMs` 限制。
- LLM 请求按 session 串行执行，不阻塞 Router 的其他 handler。

## 错误处理

- 配置读取失败、JSON 解析失败、schema 校验失败都会在启动前退出。
- Zod 错误会带路径，例如 `plugins.llm.providers.example.base`。
- 未知插件 ID 会导致启动失败。
- 插件 `configSchema` 使用 `.strict()`，未知字段会报错。
- LLM 运行错误只写日志，并向用户发送通用提示，不泄露原始错误。
