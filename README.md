# JsBot-Tellus

基于 [`@snowluma/sdk`](https://www.npmjs.com/package/@snowluma/sdk) 的 OneBot 11 QQ 机器人框架。

当前版本采用「内核 + 插件」架构：

- 内核负责配置、连接、事件分发、命令匹配、权限、gating、消息发送、SQLite 存储和生命周期。
- 插件只通过 `PluginContext` 使用内核能力，不直接接触 SDK client、Router 或数据库。
- SDK 只注册一个 middleware：`client.use(router.dispatch)`。
- 内置插件：`core`、`admin`、`poke`、`llm`。
- LLM 默认关闭，按群或私聊开启。

## 环境要求

- Node.js `>= 24.22.1`
- npm

## 快速开始

```bash
git clone https://github.com/JsBot-Dev/JsBot-Tellus
cd JsBot-Tellus
npm ci
cp bot.config.example.json bot.config.v2.json
```

编辑 `bot.config.v2.json`，至少填写连接地址、账号角色和需要的插件配置。然后：

```bash
# 构建并运行
npm run build
npm start

# 或者直接从源码运行
npm run start:source

# 开发模式（Watch）
npm run dev
```

默认配置路径是 `./bot.config.v2.json`，默认数据目录是 `./data-v2`。旧版 `bot.config.json` 和 `data/` 不会被读取或修改。

### LLM

LLM 在配置中默认关闭。启用时需要提供 provider，并建议按群白名单开启：

```json
{
    "plugins": {
        "llm": {
            "enabled": true,
            "provider": "example",
            "model": "your-model",
            "groups": {
                "allow": [123456789]
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

群聊中 @ 机器人触发，私聊由 `private` 开关控制。配置和命令详见 [docs/configuration.md](docs/configuration.md)。

## 内置命令

| 命令                  | 权限       | 作用                        |
| --------------------- | ---------- | --------------------------- |
| `/help`、`/h`         | User       | 按权限列出可用命令          |
| `/status`、`/s`       | User       | 运行时长和插件状态          |
| `/role`               | User       | 显示当前用户角色            |
| `/utter <文本>`       | Admin      | 向当前会话发送文本          |
| `/utter.raw <CQ>`     | SuperAdmin | 发送原始 CQ 消息            |
| `/provider [名称]`    | SuperAdmin | 查看或切换当前会话 provider |
| `/model [模型 ID]`    | SuperAdmin | 查看或切换当前会话模型      |
| `/persona [名称/off]` | SuperAdmin | 查看或切换当前会话 persona  |

LLM 的 provider、model、persona 按 `session > global > provider 配置` 的顺序解析。切换命令只影响当前群或私聊。

## 外部插件

使用 `--plugin-dir` 或 `BOT_PLUGIN_DIR` 加载外部插件，内置插件仍会自动加载：

```bash
node dist/app.js --plugin-dir examples/plugins
```

示例插件位于 `examples/plugins/hello`。外部插件是普通 ESM 模块，默认导出、`plugin` 命名导出或 `plugins` 数组导出均可被加载。开发和发布方式见 [docs/plugin-api.md](docs/plugin-api.md)。

## CLI

```text
jsbot [options]

--config <path>      配置文件，优先级 CLI > BOT_CONFIG > ./bot.config.v2.json
--data-dir <path>    数据目录，优先级 CLI > BOT_DATA_DIR > ./data-v2
--log-level <level>  debug、info、warn、error，优先级 CLI > BOT_LOG_LEVEL
--plugin-dir <path>  外部插件目录，优先级 CLI > BOT_PLUGIN_DIR
--help               显示帮助
```

## 开发与校验

```bash
npm run check         # TypeScript 类型检查（NodeNext + strict）
npm test              # Vitest
npm run format:check  # Prettier 检查
npm run build         # 输出 dist/
npm run smoke         # node dist/app.js --help
```

## 文档

- [架构](docs/architecture.md)
- [插件 API](docs/plugin-api.md)
- [配置](docs/configuration.md)
- [迁移与回滚](docs/migration.md)
- [功能对照](docs/feature-parity.md)

## 许可证

AGPL-3.0-or-later
