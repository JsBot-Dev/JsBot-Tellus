# WebUI

WebUI 是 JsBot-Tellus 的可选管理后台，默认关闭。它提供运行状态、会话、插件、配置、KV、日志、事件和原始 OneBot action 的管理能力。

WebUI 是**完全特权**接口：登录后可以修改机器人配置、安装插件、发送消息和调用任意 OneBot action。默认只监听 `127.0.0.1`；如果需要远程访问，请放在 HTTPS 反向代理后面，不要直接暴露到公网。

## 启用

在 `bot.config.json` 顶层增加：

```json
{
    "webui": {
        "enabled": true,
        "host": "127.0.0.1",
        "port": 8787,
        "username": "admin",
        "password": "至少 8 位",
        "sessionTtlHours": 12,
        "trustProxy": false
    }
}
```

`enabled: true` 时 `username` 和 `password` 必填，密码至少 8 位。启动后访问：

```text
http://127.0.0.1:8787
```

默认账号密码就是你写在配置里的值。修改 `username`/`password` 后保存配置，运行时会重启并清空已有登录会话；`enabled`、`host`、`port` 修改后需要重启进程才会重新绑定端口。

## 配置项

| 字段              | 默认值      | 说明                                                           |
| ----------------- | ----------- | -------------------------------------------------------------- |
| `enabled`         | `false`     | 是否启动 WebUI                                                 |
| `host`            | `127.0.0.1` | 监听地址；非回环地址会在日志中给出安全警告                     |
| `port`            | `8787`      | 监听端口                                                       |
| `username`        | 无          | 登录用户名，启用时必填                                         |
| `password`        | 无          | 登录密码，启用时必填，至少 8 位                                |
| `sessionTtlHours` | `12`        | 登录会话有效期，单位小时                                       |
| `trustProxy`      | `false`     | 是否信任 `X-Forwarded-For` / `X-Forwarded-Proto`（反向代理时） |

## 功能

- **概览**：连接状态、Bot 账号、运行时长、插件/会话数量、最近事件和日志。
- **会话**：浏览 Session、搜索、发送 QQ 消息、追加 LLM 消息、编辑 provider/model/persona、清空和删除。
- **插件**：查看插件状态、启用/私聊/群组 gating、编辑插件配置、安装/更新/卸载 npm 插件包。
- **配置**：常用设置表单 + 完整 JSON 编辑器，支持校验、保存、自动重启和失败回滚。
- **KV**：按插件查看、编辑、删除 `plugin_kv` 数据。
- **日志**：按级别/scope/关键字过滤，SSE 实时推送。
- **事件**：实时消息、通知、请求和 meta 事件流。
- **调试**：直接调用 OneBot action。

插件安装、配置保存和手动重启都会重启运行时，机器人会短暂断线；WebUI 本身会保持在线。

### 配置保存

配置页保存时：

1. 用 `appConfigSchema` 和每个已加载插件的 `configSchema` 校验；
2. 检查配置文件 hash，防止覆盖外部修改；
3. 备份当前文件到 `bot.config.json.bak`；
4. 原子写入新配置；
5. 重启运行时；
6. 如果启动失败，自动恢复旧配置并再次重启。

`accessToken` 和 `webui.password` 在页面中始终脱敏显示，留空表示保持原值。

### 启动失败

当 `webui.enabled=true` 且 Kernel 启动失败（WebSocket 连不上、插件 setup 失败等）时，进程会保留 WebUI 在线，页面显示错误。可以在配置页修正问题后直接重启运行时，不需要手动改文件。

如果配置文件本身 JSON 或 schema 错误，进程仍会在启动前退出，此时 WebUI 无法启动。

## 安全

- 密码使用 `scrypt` 哈希后比较，配置文件中的密码是明文（和 `accessToken` 一样，请限制文件权限）。
- 登录失败按 IP 限流（15 分钟 5 次）。
- 会话使用随机 token、`HttpOnly`、`SameSite=Strict` Cookie；默认 12 小时过期。
- 修改类请求要求 `X-Requested-With: jsbot-webui` 并校验 `Origin`。
- 静态资源路径穿越、请求体大小、SSE 连接数都有上限。
- 响应带 CSP、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy` 等安全头。

### 反向代理

推荐使用 Nginx/Caddy 终止 TLS，并只允许可信网络访问：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off; # SSE
}
```

同时设置 `webui.trustProxy: true`，让服务端正确识别客户端 IP 和 HTTPS Cookie。注意反向代理必须保留原始 `Host`，否则写请求的 `Origin` 校验会失败。

## 开发

```bash
npm run dev:webui    # Vite 开发服务器，/api 代理到 127.0.0.1:8787
npm run check:webui  # vue-tsc 类型检查
npm run build:webui  # 构建到 dist/webui
```

后端仍用：

```bash
npm run start:source
# 或
npm run dev
```

Vite 页面地址默认是 `http://127.0.0.1:5173`。生产构建后由 `node dist/app.js` 直接提供 `dist/webui` 静态资源。

## API

所有接口返回 `{ "data": ... }` 或 `{ "error": { "message": "...", "details": ... } }`。除 `/api/health` 和登录接口外都需要登录 Cookie。

| 分类 | 接口                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`                                                                                                 |
| 状态 | `GET /api/status`、`GET /api/commands`、`POST /api/runtime/restart`、`POST /api/runtime/pause`、`POST /api/runtime/resume`                                          |
| 日志 | `GET /api/logs`、`GET /api/logs/stream`（SSE）                                                                                                                      |
| 事件 | `GET /api/events`、`GET /api/events/stream`（SSE）                                                                                                                  |
| 会话 | `GET /api/sessions`、`GET /api/sessions/:id`、`PUT /api/sessions/:id`、`POST /api/sessions/:id/messages`、`POST /api/sessions/:id/send`、`DELETE /api/sessions/:id` |
| 插件 | `GET /api/plugins`、`PUT /api/plugins/:id/config`、`POST /api/plugins/install`、`POST /api/plugins/update`、`POST /api/plugins/remove`                              |
| 配置 | `GET /api/config`、`POST /api/config/validate`、`PUT /api/config`                                                                                                   |
| KV   | `GET /api/kv/plugins`、`GET /api/kv`、`PUT /api/kv`、`DELETE /api/kv`                                                                                               |
| 调试 | `POST /api/actions`                                                                                                                                                 |

## 故障排查

- **页面空白/提示缺少静态资源**：先执行 `npm run build`，确认 `dist/webui/index.html` 存在。
- **端口被占用**：修改 `webui.port` 后重启进程；如果 WebUI 已启用但绑定失败，日志会记录错误，机器人仍会继续启动。
- **登录后一直 401**：检查浏览器是否禁用 Cookie；反向代理是否改写 `Host`/`Origin`；`trustProxy` 是否配置正确。
- **保存配置返回 409**：配置文件被外部修改，刷新页面后重新编辑。
- **保存后机器人断线**：保存配置会重启运行时，连接恢复后自动上线。
