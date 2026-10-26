# 迁移与回滚

本项目采用 clean slate：不读取旧配置、不迁移旧数据库、不兼容旧插件和装饰器 API。

## 迁移步骤

1. 备份旧配置和数据库：

    ```bash
    cp bot.config.json bot.config.v2.backup.json
    cp -a data data.backup
    ```

2. 从模板创建新配置：

    ```bash
    cp bot.config.example.json bot.config.v2.json
    ```

3. 按 [配置文档](configuration.md) 填写 `bot.config.v2.json`。

4. 按需迁移 LLM persona。旧 KV 中的 `Personas` 不会自动读取，需要写入：

    ```json
    {
        "plugins": {
            "llm": {
                "personas": {
                    "default": "你的系统提示词"
                }
            }
        }
    }
    ```

5. 在 `data-v2/` 启动一轮测试：

    ```bash
    npm run build
    node dist/app.js --config bot.config.v2.json --data-dir data-v2
    ```

6. 验证命令、权限、群 gating、poke 和 LLM。确认后再切换生产进程和反向代理配置。

## 目录隔离

| 旧版              | 新版                      |
| ----------------- | ------------------------- |
| `bot.config.json` | `bot.config.v2.json`      |
| `data/`           | `data-v2/`                |
| 旧插件目录        | 内置插件 + `--plugin-dir` |
| 旧 KV / Session   | `data-v2/bot.db`          |

新版默认不会读取 `bot.config.json` 或 `data/`。旧文件可以原样保留，方便回退。

## 行为差异

- 命令必须在 `manifest` 中显式注册，不再依赖 import 副作用。
- 命令命中后先 `stopPropagation()`，权限不足也不会进入普通消息 handler。
- LLM 默认关闭，必须显式配置 provider 和启用范围。
- LLM 上下文按 session 存储，不再整份 KV 重写。
- LLM 的 `/provider`、`/model`、`/persona` 只修改当前群或私聊。
- 旧 `auth`、`echo`、`like-me` 不重建；权限由 `core` + `roles` 负责，发送文本由 `admin` 负责。
- 不支持热加载、插件市场和旧装饰器。

## 回滚

```bash
git switch main
npm ci
npm start
```

回退时旧 `bot.config.json` 和 `data/` 仍然是原样，直接使用旧版本启动即可。新版运行的 `data-v2/` 可以保留，不影响旧版。

如果已经部署了 `dist/`，回退前确认旧版本启动脚本没有指向 `dist/app.js` 或使用新版配置路径。
