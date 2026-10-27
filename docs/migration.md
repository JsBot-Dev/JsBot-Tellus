# 迁移与回滚

本项目采用 clean slate：不读取旧配置、不迁移旧数据库、不兼容旧插件和装饰器 API。

## 内置插件与本地插件

内置插件 `core`、`admin` 位于 `src/plugins/`，是普通源码。`poke`、`llm` 等其它插件放在 `plugins/`，该目录整体不进入 git，每个插件有自己的 `package.json`：

- 安装本地依赖：`npm install --prefix plugins/poke`、`npm install --prefix plugins/llm`
- 构建本地插件：`npm run build:local`
- 启动时加载：`--plugin-dir plugins/poke/dist --plugin-dir plugins/llm/dist`

`--plugin-dir` 可以重复，应用会跳过与内置插件同 ID 的外部插件。没有加载的插件不能出现在 `plugins` 配置中，否则会因未知插件 ID 启动失败。

发布到 npm registry 的插件也可以由 SuperAdmin 在聊天中安装：

```text
/plugin install @scope/plugin@1.0.0
/plugin list
/plugin update @scope/plugin
/plugin remove @scope/plugin
```

安装目录默认是 `<data-dir>/plugins`，安装、更新、卸载成功后会自动重启运行时。它不会修改 `plugins` 配置，因此卸载后需要手动删除对应的 `plugins.<id>`；存在残留配置时会跳过自动重启并提示手动处理。详见[插件 API](plugin-api.md#通过-npm-发布与安装)和[配置](configuration.md#插件安装器)。

## 迁移步骤

新版沿用 `bot.config.json` 和 `data/` 这两个名字。升级前先把旧文件移走，避免被新版直接使用或覆盖。

1. 备份旧配置和数据库：

    ```bash
    cp bot.config.json bot.config.legacy.json
    mv data data.legacy
    ```

2. 从模板创建新配置：

    ```bash
    cp bot.config.example.json bot.config.json
    ```

3. 按 [配置文档](configuration.md) 填写 `bot.config.json`。

4. 如果使用本地 `llm` 插件，按需迁移 persona。旧 KV 中的 `Personas` 不会自动读取，需要写入该插件的配置：

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

5. 启动一轮测试（`data/` 会自动创建）：

    ```bash
    npm run build
    npm install --prefix plugins/poke
    npm install --prefix plugins/llm
    npm run build:local
    node dist/app.js \
        --plugin-dir plugins/poke/dist \
        --plugin-dir plugins/llm/dist
    ```

6. 验证 `core`、`admin` 和已加载的本地插件。确认后再切换生产进程和反向代理配置。

## 目录对照

| 项目            | 迁移前                                       | 迁移后                               |
| --------------- | -------------------------------------------- | ------------------------------------ |
| 配置文件        | `bot.config.json` → `bot.config.legacy.json` | 新建 `bot.config.json`               |
| 数据目录        | `data/` → `data.legacy/`                     | 新建 `data/`                         |
| 旧插件目录      | 保留原样                                     | 内置 `core`/`admin` + `--plugin-dir` |
| 旧 KV / Session | 保留在 `data.legacy/bot.db`                  | `data/bot.db`                        |

新版不会读取 `bot.config.legacy.json` 或 `data.legacy/`。备份文件可以保留，方便回退。

## 行为差异

- 命令必须在 `manifest` 中显式注册，不再依赖 import 副作用。
- 命令命中后先 `stopPropagation()`，权限不足也不会进入普通消息 handler。
- 本地 `llm` 插件默认关闭，必须显式配置 provider 和启用范围。
- 本地 `llm` 插件按 session 存储上下文，不再整份 KV 重写。
- 旧 `auth`、`echo`、`like-me` 不重建；权限由 `core` + `roles` 负责，发送文本由 `admin` 负责。
- 不支持热加载、插件市场界面和旧装饰器；npm 插件安装成功后会重建运行时。
- 仓库只跟踪 `core`、`admin`；其它插件通过本地目录或外部目录加载。

## 回滚

先停掉新版，恢复旧配置和数据：

```bash
mv bot.config.json bot.config.rollback.json
mv data data.rollback
mv bot.config.legacy.json bot.config.json
mv data.legacy data
```

然后切回旧版本并启动：

```bash
git switch main
npm ci
npm start
```

新版产生的 `bot.config.rollback.json` 和 `data.rollback/` 可以保留，不影响旧版。

如果已经部署了 `dist/`，回退前确认旧版本启动脚本没有指向 `dist/app.js` 或使用新版配置路径。
