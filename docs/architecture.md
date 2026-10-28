# 架构

## 分层

```text
src/plugins/*  ->  src/core/index.ts 的公共 API（内置插件）
本地/npm 插件包 ->  @jsbot-tellus/core 的公共 API
src/core/*     ->  SDK adapter、Node 内置模块、SQLite
src/core/*     -X-> src/plugins/*
```

约束：

- 插件不能直接 import `SnowLumaWebSocketClient`。
- 插件不能直接操作 `Router`、数据库或 SDK client。
- 插件只能通过 `PluginContext`、`EventContext` 和 `BotApi` 使用能力。
- `core` 不 import 任何插件；`core`、`admin` 在 `src/plugins/index.ts` 显式注册。
- 内置插件是普通源码，随内核一起编译；没有独立依赖，不单独建包。
- 本地插件由 `src/app.ts` 在启动前扫描 `plugins/<id>/dist` 并追加到内置插件之后。
- 本地插件放在不跟踪的 `plugins/`，每个插件是独立包，构建后自动加载。

## 运行时主链路

```text
SDK WebSocket
  -> client.use(router.dispatch)
     -> Router 中间件（按 priority 降序，逐插件 gating）
     -> CommandRegistry.match（前缀最长优先，完整路径最长优先）
        -> 命中命令：stopPropagation
        -> 插件启用 / 群组 / 私聊 gating
        -> 权限检查
        -> CommandHandler
     -> 未命中命令：message / notice / request handlers（逐插件 gating）
     -> 错误隔离
```

命令一旦命中，即使插件被 gating 关闭或权限不足，也不会继续进入普通 `onMessage` handler。

## 目录

```text
src/
  app.ts                  CLI 入口
  core/
    kernel.ts             运行时组装和生命周期
    client.ts             BotClient 接口和 SDK adapter
    api.ts                BotApi
    config/               配置 schema 和加载
    dispatch/
      router.ts           唯一 SDK middleware
      command.ts          命令索引、组注册、多级匹配和冲突检测
      handler.ts          事件 handler 注册表
      middleware.ts       插件中间件注册表
      task-queue.ts       按 key 串行任务队列
    plugin/
      types.ts            插件契约和公共类型
      context.ts          PluginContext 工厂
      host.ts             插件排序、配置校验、setup/start/stop
      gating.ts           enabled/private/groups
      kv.ts               SQLite KV
      loader.ts           本地插件目录加载
    security/             角色、权限、拒绝提示
    messaging/            reply/forward 发送和回复分段
    storage/              SQLite 和 Session
    lifecycle/            启动/停止状态机
  plugins/
    core/index.ts         /help、/status、/role
    admin/index.ts        /utter、/utter raw
    index.ts              内置插件清单
plugins/                  本地插件根目录，整个目录不跟踪
  poke/
  llm/
```

## 启动顺序

```text
加载配置和本地插件
  -> 打开数据库
  -> 创建 Kernel
     -> 创建 Router、PluginGate、SessionStore、TaskQueue、BotApi
     -> 注册唯一 SDK middleware
  -> kernel.start()
     -> host.setup()：校验插件配置、创建 PluginContext、注册命令/事件/中间件
     -> client.connect()
     -> host.start()
     -> router.accepting = true
```

`host.setup()` 阶段插件只能注册能力，不应执行网络请求；需要网络的资源放在 `start()` 中。`start()` 阶段可以安全调用 `ctx.api`。

## 关闭顺序

```text
kernel.stop()
  -> router.accepting = false
  -> taskQueue.drain(drainTimeoutMs)
  -> 超时后 cancelAll()
  -> host.stop()：按启动逆序停止插件、清理 Router 注册
  -> client.close()
  -> database.close()
```

关闭是幂等的。插件 `stop()` 的异常会记录日志，不会阻止其他插件或数据库关闭。

## 失败回滚

- 插件 `setup()` 失败：已经 setup 的插件逆序停止，Router 注册被清理。
- `client.connect()` 失败：插件停止，client 和数据库关闭。
- 插件 `start()` 失败：已经启动的插件逆序停止，client 和数据库关闭。

## 构建

仓库是单包结构，没有 `workspaces`。内置插件和内核共用一个 `tsconfig.build.json`：

```bash
npm run build   # 一次 tsc，输出 dist/core 和 dist/plugins
npm run smoke   # node dist/app.js --help
```

`@jsbot-tellus/core` 的包入口指向 `dist/core/index.js`，供 `plugins/` 里的独立包在运行时解析。

## 本地插件

本地插件放在 `plugins/`，该目录整体不进入 git。每个插件是独立包，有自己的 `package.json`、lockfile 和 `node_modules`：

```bash
npm install --prefix plugins/poke
npm install --prefix plugins/llm
npm run build:local
node dist/app.js
```

应用会固定扫描 `plugins/<id>/dist`，并跳过与内置插件同 ID 的本地插件，避免重复注册。没有 `dist` 的插件目录会被跳过并记录警告。

## 在线安装插件

`admin` 插件注册 `/plugin` 指令组，通过 `ctx.core.installer` 调用 `NpmPluginInstaller`。安装器位于 `src/core/plugin/`：

```text
spec.ts             解析并校验 npm 包名 / 精确版本 / dist-tag
npm-runner.ts       execFile 调用 npm，支持超时和取消
install-dir.ts      plugins/ 的安装状态、校验脚本和 @jsbot-tellus/core 链接
install-validate.ts 在子进程中扫描插件 dist，确认它导出插件定义
installer.ts        安装 / 列表 / 卸载 / 更新、串行化、目录替换与回滚
```

安装流程：

```text
/plugin install <spec>
  -> 校验 npm registry 来源和允许列表
  -> 在 plugins/.staging-<uuid> 中 npm install <spec> --save-exact [--ignore-scripts]
  -> 把包内容移到插件目录根，依赖留在 <插件目录>/node_modules
  -> 创建 <插件目录>/node_modules/@jsbot-tellus/core 链接
  -> 子进程扫描 dist，收集 manifest.id / version / dependencies
  -> 检查 id 冲突和完整依赖图（缺失、自依赖、循环）
  -> 原子替换 plugins/<插件id>，写入 plugins/.jsbot-installed.json
  -> 自动重建运行时，由同一个本地插件加载器重新加载
```

安装或校验失败时目标目录不会被替换；更新会先用暂存目录完成下载和校验，再替换旧目录。所有安装操作通过内部队列串行执行。状态文件损坏时安装器会明确报错，不会用空状态覆盖其它包记录。

启动时加载顺序是内置插件 → `plugins/` 中的全部目录（本地插件和在线安装的插件没有区别）。重复 ID 保留先加载的插件并记录警告。安装器不直接修改运行中的插件状态；操作成功后由应用重建运行时并重新加载。卸载时如果检测到配置残留，会跳过自动重启并提示手动处理；如果其它已安装包依赖被卸载的插件，默认拒绝卸载，`--force` 可强制继续。安装器默认关闭，安装的插件是完全可信的宿主进程代码。

## 测试边界

- `FakeClient` 替代真实 WebSocket。
- 内存 SQLite 替代 `data/` 目录。
- Router、PluginHost、TaskQueue、Session、`core` 和 `admin` 都有独立测试。
- 安装器使用假的 npm runner 和校验器覆盖安装、回滚、卸载、更新、并发和禁用场景；子进程校验脚本另有真实测试。
