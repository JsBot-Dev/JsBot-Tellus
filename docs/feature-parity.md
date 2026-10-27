# 功能对照

## 保留并重建

| 旧能力        | 新位置                     | 说明                                           |
| ------------- | -------------------------- | ---------------------------------------------- |
| 配置加载      | `core/config`              | Zod schema，错误带路径                         |
| WebSocket     | `core/client.ts`           | 只暴露 `BotClient`                             |
| 命令注册      | `core/plugin/types.ts`     | `definePlugin` + Router 注册表                 |
| 权限          | `core/security`            | `User/Admin/SuperAdmin`                        |
| 群开关        | `PluginGate`               | `enabled/private/groups`                       |
| 消息发送      | `core/messaging/sender.ts` | reply、长消息 forward                          |
| 插件 KV       | `core/plugin/kv.ts`        | 按插件 ID 隔离的 SQLite KV                     |
| 管理发送      | `src/plugins/admin`        | `/utter`、`/utter.raw`                         |
| 角色查询/帮助 | `src/plugins/core`         | `/role`、`/help`、`/status`                    |
| 内置插件      | `src/plugins/*`            | 普通源码，随内核编译                           |
| 在线安装      | `core/plugin/installer.ts` | `/plugin install/list/remove/update`，重启生效 |

## 本地插件

以下插件保留在本地，但不进入仓库，通过 `--plugin-dir` 加载：

| 能力 | 位置           | 说明                                         |
| ---- | -------------- | -------------------------------------------- |
| poke | `plugins/poke` | 回复与冷却                                   |
| LLM  | `plugins/llm`  | Session 上下文、限流、provider/model/persona |

## 有意不重建

| 旧能力                            | 处理方式                                        |
| --------------------------------- | ----------------------------------------------- |
| 装饰器                            | 删除；使用 `definePlugin` 和显式注册器          |
| `JsBotBasePlugin` / PluginManager | 删除；由 Kernel + PluginHost 接管               |
| 旧安全中间件                      | 删除；Router 命中命令后统一检查权限             |
| 旧 KV 全局结构                    | 删除；使用按插件命名空间的 KV 和 Session        |
| `auth` 插件                       | 不重建；角色判断进入 `core` 和配置              |
| `echo` 插件                       | 不重建；由 `admin` 的 `/utter` 覆盖             |
| `like-me`                         | 不重建                                          |
| 旧配置/旧 DB                      | 不读取、不迁移                                  |
| 热加载 / 插件市场界面             | 不在范围内；支持 npm 安装，成功后自动重启运行时 |

## 验收场景

- 只注册一个 SDK middleware。
- 命令命中后不会进入普通消息 handler。
- 禁用命令不会穿透到普通消息 handler。
- 权限不足不执行 handler，并返回通用提示。
- 中间件和事件 handler 异常相互隔离。
- 插件 setup/start 失败可以回滚。
- 长消息转 forward，短消息默认引用回复。
- 配置错误包含路径，未知插件 ID 启动失败。
- 外部插件目录可以加载并执行。
- 本地插件可以通过 `--plugin-dir` 加载。
- 已安装的 npm 插件包可以在自动重启后加载，安装失败会回滚。
- 非 SuperAdmin 不能使用 `/plugin` 的任何子命令，包括 `help` 和 `list`。
- `npm run build` 后 `node dist/app.js` 可用。
