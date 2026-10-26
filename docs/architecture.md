# 架构

## 分层

```text
src/plugins/*  ->  src/core/index.ts 的公共 API
src/core/*     ->  SDK adapter、Node 内置模块、SQLite
src/core/*     -X-> src/plugins/*
```

约束：

- 插件不能直接 import `SnowLumaWebSocketClient`。
- 插件不能直接操作 `Router`、数据库或 SDK client。
- 插件只能通过 `PluginContext`、`EventContext` 和 `BotApi` 使用能力。
- `core` 不 import 任何内置插件；内置插件在 `src/plugins/index.ts` 显式注册。
- 外部插件由 `src/app.ts` 在启动前扫描并追加到内置插件之后。

## 运行时主链路

```text
SDK WebSocket
  -> client.use(router.dispatch)
     -> Router 中间件（按 priority 降序，逐插件 gating）
     -> CommandRegistry.match
        -> 命中命令：stopPropagation
        -> 插件启用 / 群组 / 私聊 gating
        -> 权限检查
        -> CommandHandler
     -> 未命中命令：message / notice / request handlers（逐插件 gating）
     -> 错误隔离
```

命令一旦命中，即使插件被 gating 关闭或权限不足，也不会继续进入普通 `onMessage` handler。这样可以避免命令消息被 LLM 等普通消息 handler 重复处理。

## 目录

```text
src/
  app.ts                  CLI 入口
  core/
    kernel.ts             运行时组装和生命周期
    client.ts             BotClient 接口和 SDK adapter
    api.ts                BotApi
    config/               v2 配置 schema 和加载
    dispatch/
      router.ts           唯一 SDK middleware
      command.ts          命令索引和冲突检测
      handler.ts          事件 handler 注册表
      middleware.ts       插件中间件注册表
      task-queue.ts       按 key 串行任务队列
    plugin/
      types.ts            插件契约和公共类型
      context.ts          PluginContext 工厂
      host.ts             插件排序、配置校验、setup/start/stop
      gating.ts           enabled/private/groups
      kv.ts               SQLite KV
      loader.ts           外部插件目录加载
    security/             角色、权限、拒绝提示
    messaging/            reply/forward 发送和回复分段
    storage/              SQLite 和 Session
    lifecycle/            启动/停止状态机
  plugins/
    core/                 /help、/status、/role
    admin/                /utter、/utter.raw
    poke/                 poke 回复
    llm/                  OpenAI 兼容 LLM
  plugins/index.ts        内置插件清单
```

## 启动顺序

```text
加载配置和外部插件
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

## 测试边界

- `FakeClient` 替代真实 WebSocket。
- 内存 SQLite 替代 `data-v2`。
- `FakeLlm` 注入 `LlmRuntimeFactory`，测试不访问网络。
- Router、PluginHost、TaskQueue、Session 和每个内置插件都有独立测试。
