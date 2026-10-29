# JsBot-Tellus

基于 [`@snowluma/sdk`](https://www.npmjs.com/package/@snowluma/sdk) 的 OneBot 11 QQ 机器人框架。

当前版本采用「内核 + 插件」架构：

- 内核负责配置、连接、事件分发、命令匹配、权限、gating、消息发送、SQLite 存储和生命周期。
- 插件只通过 `PluginContext` 使用内核能力，不直接接触 SDK client、Router 或数据库。
- SDK 只注册一个 middleware：`client.use(router.dispatch)`。
- 内置插件 `core`、`admin` 是普通源码，位于 `src/plugins/`，随内核一起编译。
- `poke`、`llm` 等本地插件放在不跟踪的 `plugins/`，各自是独立包，从 `plugins/<id>/dist` 自动加载；缺少 `dist` 时会先尝试自动构建。

## 环境要求

- Node.js `^24.22.1 || >=26.12.1`（与 `@snowluma/sdk` 保持一致）
- npm

## 安装

```bash
npm install -g @jsbot-tellus/core
jsbot --config ./bot.config.json
```

也可以从源码运行，见下方快速开始。

## 快速开始

```bash
git clone https://github.com/JsBot-Dev/JsBot-Tellus
cd JsBot-Tellus
npm ci
cp bot.config.example.json bot.config.json
```

编辑 `bot.config.json`，至少填写连接地址和账号角色。然后：

```bash
# 构建并运行
npm run build
npm start

# 或者直接从源码运行
npm run start:source

# 开发模式（Watch）
npm run dev
```

默认配置路径是 `./bot.config.json`，默认数据目录是 `./data`。从旧版升级前请先备份并移走旧配置和数据库，见[迁移与回滚](docs/migration.md)。

## 内置命令

| 命令              | 权限       | 作用                             |
| ----------------- | ---------- | -------------------------------- |
| `/help`、`/h`     | User       | 按权限和当前会话启用状态列出命令 |
| `/status`、`/s`   | User       | 运行时长和插件状态               |
| `/role`           | User       | 显示当前用户角色                 |
| `/utter <文本>`   | Admin      | 向当前会话发送文本               |
| `/utter raw <CQ>` | SuperAdmin | 发送原始 CQ 消息                 |
| `/plugin list`    | SuperAdmin | 列出已安装插件包                 |
| `/plugin install` | SuperAdmin | 安装 npm 插件包                  |
| `/plugin remove`  | SuperAdmin | 卸载插件包                       |
| `/plugin update`  | SuperAdmin | 更新插件包                       |

`/plugin` 的所有子命令（包括 `help` 和 `list`）都要求 SuperAdmin。`/utter.raw` 已迁移为 `/utter raw` 子命令。

## 内置与本地插件

内置插件是普通源码，不需要独立的 `package.json`：

```text
src/plugins/
  core/index.ts     /help、/status、/role
  admin/index.ts    /utter、/utter raw
  index.ts          内置插件清单
```

它们只依赖根 `package.json` 里的 `zod`，所以随内核一次 `tsc` 构建，产物在 `dist/plugins/`。

`poke`、`llm` 等本地插件放在 `plugins/`，该目录整体被 `.gitignore` 排除。每个插件都是独立包，有自己的 `package.json`、`tsconfig.json`、lockfile、`node_modules` 和构建脚本：

```bash
npm install --prefix plugins/poke
npm install --prefix plugins/llm
npm run build:local

node dist/app.js
```

应用启动时会固定扫描 `plugins/<id>/dist`，不需要路径参数。`plugins/` 中没有 `dist` 的本地插件如果带有 `build` 脚本且依赖已安装，会先自动执行 `npm run build` 再加载；没有 `build` 脚本、缺少 `node_modules` 或构建失败时会记录警告并跳过该插件。`plugins/` 中与内置插件同 ID 的插件也会被跳过。本地插件是普通 ESM 模块，默认导出、`plugin` 命名导出或 `plugins` 数组导出均可被加载。开发和发布方式见 [插件开发指南](docs/plugin-development.md)，示例位于 [`examples/plugins/hello`](examples/plugins/hello)。

## 在线安装插件包

在聊天中由 SuperAdmin 执行：

```text
/plugin install @scope/plugin@1.0.0
/plugin list
/plugin update @scope/plugin
/plugin remove @scope/plugin
```

- 只接受 npm registry 包，`name`、`name@版本`、`name@tag`、`@scope/name[@版本|tag]`；拒绝 git、file、URL、workspace、link 等来源。
- 包会直接安装到 `plugins/<插件id>/`，和本地插件一样从 `plugins/<插件id>/dist` 加载；不会放进共享的 `node_modules`。每个包带自己的依赖，不影响内核依赖。
- 首次安装时，一个包导出多个插件会使用包名作为目录（例如 `@scope/bundle` 对应 `plugins/@scope__bundle/`）。
- 安装、更新、卸载成功后会自动重启运行时并加载新插件，无需手动重启；进程本身不会退出。`/plugin list` 会标记“已加载”或“重启后生效”。安装状态保存在 `plugins/.jsbot-installed.json`。
- 默认使用 `--ignore-scripts`；只有显式设置 `installer.allowScripts=true` 才会执行 npm 生命周期脚本。
- 卸载不会修改 `plugins` 配置。如果配置里仍有对应插件 ID，命令会给出警告并跳过自动重启，需要在处理配置后手动重启；其它已安装包依赖被卸载插件 ID 时默认拒绝卸载，可使用 `/plugin remove <目标> --force` 强制卸载。

安装器默认关闭，需要显式设置 `installer.enabled=true`。启用后 `/plugin` 的所有子命令（包括只读的 `/plugin list`）都要求 SuperAdmin；安装的插件是运行在宿主进程中的完全可信代码。配置项见 [docs/configuration.md](docs/configuration.md#插件安装器)，发布要求见 [docs/plugin-api.md](docs/plugin-api.md#通过-npm-发布与安装)。

## CLI

```text
jsbot [options]

--config <path>      配置文件，优先级 CLI > BOT_CONFIG > ./bot.config.json
--data-dir <path>    数据目录，优先级 CLI > BOT_DATA_DIR > ./data
--log-level <level>  debug、info、warn、error，优先级 CLI > BOT_LOG_LEVEL
--help               显示帮助

本地插件固定从 ./plugins/<id>/dist 自动加载；缺少 dist 时会先自动构建。
```

## 开发与校验

```bash
npm run check         # TypeScript 类型检查（NodeNext + strict）
npm test              # Vitest
npm run format:check  # Prettier 检查
npm run build         # 构建内核、内置插件和 CLI
npm run smoke         # node dist/app.js --help

npm run check:local   # 检查 plugins（需要先安装本地依赖）
npm run build:local   # 构建 plugins
npm run plugin:gen -- my-plugin  # 生成并安装 plugins/my-plugin 模板依赖
```

## 发布

发布由 [`.github/workflows/cd.yaml`](.github/workflows/cd.yaml) 驱动：`main` 的 CI 成功后自动通过 npm Trusted Publisher 发布；已存在的版本会跳过。不需要版本标签。检查、构建和首次配置见[发布流程](docs/release.md)。

## 文档

- [架构](docs/architecture.md)
- [插件开发](docs/plugin-development.md)
- [插件 API](docs/plugin-api.md)
- [配置](docs/configuration.md)
- [迁移与回滚](docs/migration.md)
- [功能对照](docs/feature-parity.md)
- [发布流程](docs/release.md)

## 许可证

AGPL-3.0-or-later
