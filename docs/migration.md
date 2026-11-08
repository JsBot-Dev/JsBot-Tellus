# 迁移与回滚

本项目采用 clean slate：不读取旧配置、不迁移旧数据库、不兼容旧插件和装饰器 API。

## 内置插件与本地插件

内置插件 `core`、`admin` 位于 `src/plugins/`，是普通源码。`poke`、`llm` 等其它插件放在 `plugins/`，该目录整体不进入 git，每个插件有自己的 `package.json`：

- 安装本地依赖：`npm install --prefix plugins/poke`、`npm install --prefix plugins/llm`
- 构建本地插件：`npm run build:plugin`
- 启动和重启时加载：应用会自动扫描 `plugins/<id>/dist`，不需要路径参数

应用会跳过与内置插件同 ID 的本地插件。没有加载的插件如果仍有配置文件，只会记录警告并忽略该文件，不再阻止启动。

管理命令方面，`/utter.raw` 已迁移为 `/utter raw` 指令组子命令。

发布到 npm registry 的插件也可以由 SuperAdmin 在聊天中安装：

```text
/plugin install @scope/plugin@1.0.0
/plugin list
/plugin update @scope/plugin
/plugin remove @scope/plugin
```

包会直接安装到 `plugins/<插件id>/`，和本地插件使用同一个目录、同一个加载器；安装、更新、卸载成功后会自动重启运行时。它不会修改插件配置文件，因此卸载后需要手动删除对应的 `data/config/plugin/<id>.jsonc`；存在残留配置时会跳过自动重启并提示手动处理。旧版本的 `<data-dir>/plugins` 安装目录不再读取，升级后需要用 `/plugin install` 重新安装在线插件；旧配置中的 `installer.dir` 也已移除，继续保留会导致配置校验失败，需要删除该字段。详见[插件 API](plugin-api.md#通过-npm-发布与安装)和[配置](configuration.md#插件安装器)。

## 迁移步骤

新版使用 `bot.config.jsonc` 和 `data/`。旧版的 `bot.config.json` 仍可被识别，但建议一并迁移到 `.jsonc`。升级前先把旧文件移走，避免被新版直接使用或覆盖。

1. 备份旧配置和数据库：

    ```bash
    cp bot.config.json bot.config.legacy.json
    mv data data.legacy
    ```

2. 从模板创建新配置：

    ```bash
    cp bot.config.example.jsonc bot.config.jsonc
    ```

3. 按 [配置文档](configuration.md) 填写 `bot.config.jsonc`。

4. 如果使用本地 `llm` 插件，按需迁移 persona。旧 KV 中的 `Personas` 不会自动读取，需要写入该插件的配置文件 `data/config/plugin/llm.jsonc`：

    ```jsonc
    {
        "personas": {
            "default": "你的系统提示词",
        },
    }
    ```

5. 启动一轮测试（`data/` 会自动创建）：

    ```bash
    npm run build
    npm install --prefix plugins/poke
    npm install --prefix plugins/llm
    npm run build:plugin
    node dist/app.js
    ```

6. 验证 `core`、`admin` 和已加载的本地插件。确认后再切换生产进程和反向代理配置。

## 3.0 插件配置迁移

3.0 起插件配置从主配置文件的 `plugins` 字段拆分到独立文件，且**不会自动迁移**。3.2 起保留 `plugins` 字段（即使是空对象）只会记录警告并忽略，不再阻止启动；WebUI 保存配置时会自动移除该字段。

迁移步骤：

1. 创建目录 `<data-dir>/config/plugin/`（默认是 `data/config/plugin/`）。
2. 对旧 `plugins` 中的每个插件，创建 `<id>.jsonc`，内容是该插件的完整配置，包括 `enabled`、`private`、`groups` 和插件自己的选项。例如旧配置：

    ```json
    {
        "plugins": {
            "demo": {
                "enabled": true,
                "groups": { "allow": [123] },
                "limit": 20
            }
        }
    }
    ```

    应拆分为 `data/config/plugin/demo.jsonc`：

    ```jsonc
    {
        "enabled": true,
        "groups": { "allow": [123] },
        "limit": 20,
    }
    ```

3. 从 `bot.config.jsonc` 中删除整个 `plugins` 字段。
4. 启动一次，检查日志中是否有插件配置警告。缺失、无效或未加载插件 ID 对应的文件只会记录警告并跳过，不会阻止启动。

文件支持 JSONC 注释和尾随逗号；WebUI 保存时会写成标准 JSON，注释会丢失。`bot.config.jsonc` 里的其它字段和 `data/` 下的数据库不需要迁移。

## 3.1 主配置改用 JSONC

3.1 起默认主配置文件改为 `bot.config.jsonc`，和插件配置一样支持注释与尾随逗号。如果 `bot.config.jsonc` 不存在但旧的 `bot.config.json` 存在，启动时会回退读取旧文件并输出警告；显式通过 `--config` 或 `BOT_CONFIG` 指定的路径始终优先。

迁移步骤：

1. 重命名文件：

    ```bash
    mv bot.config.json bot.config.jsonc
    ```

2. 按需添加注释或尾随逗号。WebUI 保存配置时会写成标准 JSON，注释会丢失。

3. 启动一次，确认日志中没有 `using legacy bot.config.json` 警告。

## 3.2 旧 plugins 字段改为忽略

3.2 起主配置中的 `plugins` 字段不再阻止启动，只会记录警告并忽略；WebUI 保存配置时会自动移除该字段。插件配置仍从 `<data-dir>/config/plugin/<id>.jsonc` 读取，不会自动迁移。

如果你还没有拆分旧配置，可以按上面的 [3.0 插件配置迁移](#30-插件配置迁移) 手动处理。

## 目录对照

| 项目            | 迁移前                                       | 迁移后                           |
| --------------- | -------------------------------------------- | -------------------------------- |
| 配置文件        | `bot.config.json` → `bot.config.legacy.json` | 新建 `bot.config.jsonc`          |
| 数据目录        | `data/` → `data.legacy/`                     | 新建 `data/`                     |
| 旧插件目录      | 保留原样                                     | 内置 `core`/`admin` + `plugins/` |
| 旧 KV / Session | 保留在 `data.legacy/bot.db`                  | `data/bot.db`                    |
| 插件配置        | 主配置文件的 `plugins`                       | `data/config/plugin/<id>.jsonc`  |

新版不会读取 `bot.config.legacy.json` 或 `data.legacy/`。备份文件可以保留，方便回退。

## 行为差异

- 命令必须在 `manifest` 中显式注册，不再依赖 import 副作用。
- 命令命中后先 `stopPropagation()`，权限不足也不会进入普通消息 handler。
- 本地 `llm` 插件默认关闭，必须显式配置 provider 和启用范围。
- 本地 `llm` 插件按 session 存储上下文，不再整份 KV 重写。
- 插件配置拆分到 `<data-dir>/config/plugin/<id>.jsonc`，主配置中的旧 `plugins` 字段会被忽略并警告。
- 插件配置缺失或无效时只警告并跳过对应插件，不再阻止 Kernel 启动。
- 旧 `auth`、`echo`、`like-me` 不重建；权限由 `core` + `roles` 负责，发送文本由 `admin` 负责。
- 不支持热加载、插件市场界面和旧装饰器；npm 插件安装成功后会重建运行时。
- 仓库只跟踪 `core`、`admin`；其它插件从 `plugins/` 加载，在线安装的插件也在这里。

## 回滚

先停掉新版，恢复旧配置和数据：

```bash
mv bot.config.jsonc bot.config.rollback.jsonc
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

新版产生的 `bot.config.rollback.jsonc` 和 `data.rollback/` 可以保留，不影响旧版。

如果已经部署了 `dist/`，回退前确认旧版本启动脚本没有指向 `dist/app.js` 或使用新版配置路径。
