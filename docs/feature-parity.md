# 功能对照

## 保留并重建

| 旧能力        | 新位置                     | 说明                                         |
| ------------- | -------------------------- | -------------------------------------------- |
| 配置加载      | `core/config`              | v2 schema，错误带路径                        |
| WebSocket     | `core/client.ts`           | 只暴露 `BotClient`                           |
| 命令注册      | `core/plugin/types.ts`     | `definePlugin` + Router 注册表               |
| 权限          | `core/security`            | `User/Admin/SuperAdmin`                      |
| 群开关        | `PluginGate`               | `enabled/private/groups`                     |
| 消息发送      | `core/messaging/sender.ts` | reply、长消息 forward                        |
| 插件 KV       | `core/plugin/kv.ts`        | 按插件 ID 隔离的 SQLite KV                   |
| poke          | `plugins/poke`             | 回复与冷却                                   |
| 管理发送      | `plugins/admin`            | `/utter`、`/utter.raw`                       |
| LLM           | `plugins/llm`              | Session 上下文、限流、provider/model/persona |
| 角色查询/帮助 | `plugins/core`             | `/role`、`/help`、`/status`                  |

## 有意不重建

| 旧能力                            | 处理方式                                     |
| --------------------------------- | -------------------------------------------- |
| 装饰器                            | 删除；使用 `definePlugin` 和显式注册器       |
| `JsBotBasePlugin` / PluginManager | 删除；由 Kernel + PluginHost 接管            |
| 旧安全中间件                      | 删除；Router 命中命令后统一检查权限          |
| 旧 KV 全局结构                    | 删除；使用按插件命名空间的 KV 和 Session     |
| `auth` 插件                       | 不重建；角色判断进入 `core` 和配置           |
| `echo` 插件                       | 不重建；由 `admin` 的 `/utter` 覆盖          |
| `like-me`                         | 不重建                                       |
| 工作区插件包                      | 删除；内置插件显式注册，外部插件通过目录加载 |
| 旧配置/旧 DB                      | 不读取、不迁移                               |
| 热加载/插件市场                   | 不在范围内                                   |

## 验收场景

- 只注册一个 SDK middleware。
- 命令命中后不会进入普通消息 handler。
- 禁用命令不会穿透到 LLM。
- 权限不足不执行 handler，并返回通用提示。
- 中间件和事件 handler 异常相互隔离。
- 插件 setup/start 失败可以回滚。
- 长消息转 forward，短消息默认引用回复。
- LLM 默认无请求、无记录。
- LLM 多轮上下文、限流、失败提示、停止时取消。
- 配置错误包含路径，未知插件 ID 启动失败。
- 外部插件目录可以加载并执行。
- `npm run build` 后 `node dist/app.js` 可用。
