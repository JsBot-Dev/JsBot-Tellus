# 插件开发指南

本文面向插件开发者，说明插件应该放在哪里、如何创建和构建、如何加载调试，以及发布到 npm 前需要检查什么。

API 细节（`PluginContext`、命令、事件、中间件、KV、Session 等）见[插件 API](plugin-api.md)。

## 先选插件类型

| 类型     | 推荐位置            | 是否进入本仓库 | 加载方式                           | 适用场景                     |
| -------- | ------------------- | -------------- | ---------------------------------- | ---------------------------- |
| 内置插件 | `src/plugins/<id>/` | 是             | 注册到 `src/plugins/index.ts`      | 随内核发布的官方功能         |
| 本地插件 | `plugins/<id>/`     | 否             | 启动时自动扫描 `plugins/<id>/dist` | 个人使用、内部功能、开发调试 |
| npm 插件 | 独立仓库或独立包    | 独立管理       | `/plugin install <包名>[@版本]`    | 发布给其他用户安装           |

位置约定：

- `plugins/` 已被 `.gitignore` 忽略，适合放不准备提交到本仓库的本地插件。
- 只有准备随内核一起发布的官方插件才放进 `src/plugins/`；本地插件不要直接写进 `src/`。
- 目录名建议与 `manifest.id` 一致，使用 kebab-case，例如 `plugins/my-plugin/` 对应 `id: 'my-plugin'`。
- 发布到 npm 的插件，`manifest.id` 必须匹配 `[a-z0-9][a-z0-9._-]*`；本地插件也建议使用相同的 kebab-case 格式。无论哪种插件，ID 都必须在所有已加载插件中唯一。
- 插件 ID 重复时按“内置插件 → `plugins/` 目录（本地插件和在线安装的插件）”的顺序保留先加载的插件，后面的会被跳过并记录警告。

## 目录结构

### 本地插件

推荐结构：

```text
plugins/my-plugin/
  package.json
  tsconfig.json
  src/
    index.ts
  dist/
    index.js
    index.d.ts
```

- `src/index.ts` 是开发入口。
- `dist/index.js` 是运行时入口。
- 构建产物固定放在 `plugins/<id>/dist`，启动时自动扫描；不要指向或加载 `src/`。
- 每个本地插件都是独立包，有自己的 `package.json`、lockfile 和 `node_modules`。

### 内置插件

```text
src/plugins/my-plugin/
  index.ts
  ...
```

新增内置插件后需要在 `src/plugins/index.ts` 中导入并加入 `builtinPlugins`：

```ts
import type { AnyPluginDefinition } from '../core/index.js'
import { adminPlugin } from './admin/index.js'
import { corePlugin } from './core/index.js'
import { myPlugin } from './my-plugin/index.js'

export const builtinPlugins: AnyPluginDefinition[] = [
    corePlugin,
    adminPlugin,
    myPlugin,
]
```

内置插件和内核共用根目录的 `tsconfig.build.json`，执行 `npm run build` 后会输出到 `dist/plugins/`。

### npm 插件

npm 插件通常在独立仓库中开发，发布构建后的 `dist/`。安装器会把它直接放到 `plugins/<插件id>/`，和本地插件一样从 `plugins/<插件id>/dist` 加载。首次安装时，一个包导出多个插件会使用包名作为目录（例如 `@scope/bundle` 对应 `plugins/@scope__bundle/`）。

## 从零创建本地插件

### 快速生成

在仓库根目录执行：

```bash
npm run plugin:gen -- my-plugin
```

也可以不带参数运行 `npm run plugin:gen`，在终端中交互输入插件 id。

生成结果是 `plugins/my-plugin/`，包含：

```text
plugins/my-plugin/
  package.json
  tsconfig.json
  README.md
  src/index.ts
```

可选参数：

```bash
npm run plugin:gen -- my-plugin --name @yourscope/plugin-my-plugin
npm run plugin:gen -- my-plugin --description "My plugin"
npm run plugin:gen -- my-plugin --no-install
```

生成器默认会执行 `npm install`。如果使用 `--no-install` 或安装失败，可以手动补装：

```bash
npm install --prefix plugins/my-plugin
```

然后构建并启动：

```bash
npm run build --prefix plugins/my-plugin
node dist/app.js
```

如果目标目录已经存在，命令会拒绝覆盖。

下面以手动创建 `plugins/my-plugin/` 为例。

### 1. 创建 package.json

```json
{
    "name": "@yourscope/plugin-my-plugin",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
        "build": "tsc -p tsconfig.json",
        "check": "tsc -p tsconfig.json --noEmit",
        "watch": "tsc -p tsconfig.json --watch"
    },
    "devDependencies": {
        "@jsbot-tellus/core": "^2.0.3",
        "@types/node": "^24.6.4",
        "typescript": "^7.0.2"
    },
    "dependencies": {
        "zod": "^4.6.7"
    }
}
```

依赖约定：

- `@jsbot-tellus/core` 只用于类型和 `definePlugin`，放在 `devDependencies`。
- 插件自己的第三方运行时依赖放在 `dependencies`。
- 不要把 `@jsbot-tellus/core` 写进 `dependencies` 或 `peerDependencies`。
- 通过 `/plugin install` 安装的包，宿主会在 `plugins/<目录>/node_modules/@jsbot-tellus/core` 创建链接；手动放在 `plugins/` 的本地插件需要自己安装 core。正常执行 `npm install --prefix plugins/<id>` 会安装 `devDependencies`，已经满足这个条件。
- 在本仓库内联调本地内核时，可以把 core 改成 `"file:../.."`，但需要先执行根目录的 `npm run build`，并且发布前要改回版本号。
- 仅在本机使用的插件可以保留 `"private": true`；准备发布到 npm 时删除它。

### 2. 创建 tsconfig.json

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "noEmit": false,
        "outDir": "dist",
        "rootDir": "src",
        "declaration": true,
        "sourceMap": true
    },
    "include": ["src"]
}
```

如果插件不在本仓库内，把 `extends` 换成自己的基础配置即可。使用 NodeNext 时，TypeScript 源码里的相对导入要带 `.js` 扩展名，例如：

```ts
import { helper } from './helper.js'
```

### 3. 编写入口

```ts
import { definePlugin } from '@jsbot-tellus/core'
import { z } from 'zod'

export default definePlugin({
    manifest: {
        id: 'my-plugin',
        version: '0.1.0',
        description: 'My local plugin',
        defaultEnabled: true,
        configSchema: z
            .object({
                reply: z.string().default('hello from my plugin'),
            })
            .strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: 'hello',
                permission: 'User',
                description: '发送一条问候',
                params: '[name:string="世界"]',
            },
            async (_event, context, _match, name) => {
                await context.send(`${name}：${ctx.config.reply}`)
            }
        )
    },
})
```

需要注意：

- `definePlugin` 只提供类型推导，不会产生全局副作用。
- `setup()` 只注册命令、事件和中间件；定时器、连接等运行时资源放在 `start()`，并在 `stop()` 中清理。
- 命令可以用 `params` 声明位置参数；解析结果从 handler 第四个参数开始传入，用法会自动出现在 `/help` 和指令组提示中。详见[插件 API 的参数章节](plugin-api.md#参数)。
- 多级命令（例如 `/plugin install`）使用 `ctx.commands.group()`，不要直接注册带空格的命令名。详见[插件 API 的命令章节](plugin-api.md#命令)。
- 修改命令、事件或配置后，完整重启进程最可靠；自动重启不会清空 ESM 模块缓存。

### 4. 安装依赖并构建

```bash
npm install --prefix plugins/my-plugin
npm run build
npm run build --prefix plugins/my-plugin
```

根目录的 `npm run build:local` / `npm run check:local` 目前只覆盖 `plugins/poke` 和 `plugins/llm`。新增插件请使用 `npm run build --prefix plugins/<id>` 和 `npm run check --prefix plugins/<id>`，或者把新目录加入根 `package.json` 的对应脚本。

开发时可以单独开一个终端监听：

```bash
npm run watch --prefix plugins/my-plugin
```

### 5. 启动并加载

本地插件目录固定为 `plugins/`，相对当前工作目录解析。应用启动时会自动扫描：

```text
plugins/
  my-plugin/
    dist/
      index.js
  another-plugin/
    dist/
      index.js
```

```bash
node dist/app.js
```

开发模式：

```bash
npm run dev
```

不需要额外参数；多个本地插件按 `plugins/<id>/dist` 并存。没有 `dist` 的目录会被跳过并记录警告。

### 6. 配置插件

在 `bot.config.json` 中按插件 ID 配置：

```json
{
    "plugins": {
        "my-plugin": {
            "enabled": true,
            "reply": "hello from config"
        }
    }
}
```

- `enabled`、`private`、`groups` 是内核处理的信封字段，不会传给 `configSchema`。
- 其它字段由插件的 `configSchema` 校验；未知字段会报错，错误信息会带 `plugins.my-plugin.xxx` 这样的路径。
- 如果 `manifest.defaultEnabled` 为 `true`，可以省略 `enabled`。
- 配置里出现未加载的插件 ID 会导致启动失败；删除插件后记得同步删除对应配置。

## 加载规则

- 加载器会递归扫描每个 `plugins/<id>/dist` 中的 `.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.cts` 文件，忽略 `node_modules` 和 `.d.ts`。
- 只识别以下导出形式：
    - `export default plugin`
    - `export const plugin = ...`
    - `export const plugins = [...]`
- 没有导出插件定义的 helper 模块会被跳过。
- 生产环境应加载编译后的 JavaScript；TypeScript 源码必须先构建，或者在使用 `tsx` 的开发环境中运行。
- 空目录不会报错；如果目录中存在无法导入或无法识别的文件，并且最终没有加载到任何有效插件，启动失败。只要至少有一个有效插件，其他无法识别的文件会记录警告并跳过。
- 本地插件和在线安装的插件都从 `plugins/<目录>/dist` 自动加载，没有单独的安装目录。
- 同一个 ID 同时来自内置插件和 `plugins/` 中的多个目录时，只有最先加载的那个生效。

## 调试与常见问题

| 现象                                                 | 可能原因                                             | 处理                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `skipping local plugin ... dist directory not found` | 插件目录没有构建产物                                 | 执行 `npm run build --prefix plugins/<id>`                                 |
| `failed to import ...`                               | TypeScript 未编译、入口有运行时错误                  | 先构建；查看日志中的具体导入错误                                           |
| `dist` 目录没有有效插件                              | 没有导出 `default` / `plugin` / `plugins`            | 检查入口导出和 `dist` 中的构建输出                                         |
| `skipping ... plugin id already loaded`              | 插件 ID 重复                                         | 修改 `manifest.id`，或移除重复的插件目录                                   |
| `unknown plugin id`                                  | 配置里写了未加载的插件 ID                            | 启用插件、修正 ID，或删除 `plugins.<id>` 配置                              |
| 命令没有响应                                         | 插件未启用、权限不足、群组 gating、命令前缀不匹配    | 检查 `plugins.<id>.enabled`、角色、群组配置和命令前缀                      |
| 修改代码后行为没变                                   | ESM 模块缓存、自动重启未刷新本地插件                 | 完整退出并重新启动进程                                                     |
| `Cannot find module '@jsbot-tellus/core'`            | 没有安装 devDependency，或 `file:` 依赖尚未构建      | 在插件目录执行 `npm install`；使用 `file:` 时先构建根项目                  |
| `/plugin install` 拒绝包                             | 使用了路径、`file:`、git/url、范围版本或未启用安装器 | 改用 npm 包名 + 精确版本或 dist-tag；确认 `installer.enabled` 和 allowlist |
| 安装完成但提示网络错误                               | 安装后的通知发送失败，不代表安装失败                 | 用 `/plugin list` 确认；必要时手动重启进程                                 |

注意：安装器在安装或更新成功后会请求重建运行时，但安装后的通知发送失败不会回滚安装。遇到“网络连接异常”时优先检查 `/plugin list` 和 `plugins/.jsbot-installed.json`。

## 发布到 npm

发布前确认包满足以下要求：

- 使用 ESM：`"type": "module"`。
- 发布 `dist/` 中的 JavaScript 和 `.d.ts`，不要依赖安装后的 `postinstall` 构建；运行时加载器会扫描 `dist/`。
- 建议通过 `main` 或 `exports["."]` 指向 `dist/index.js`，方便类型和工具解析。
- `dist/` 中导出的插件定义会被加载：`export default plugin`、`export const plugin = ...` 或 `export const plugins = [...]`。
- `manifest.id` 全局唯一，不能与内置插件、`plugins/` 本地插件或其它已安装插件冲突。
- 插件之间的依赖写在 `manifest.dependencies`，依赖的插件必须由同一个包导出，或已经由其它已安装包提供。
- 第三方运行时依赖写入 `dependencies`。
- 不要依赖源码仓库或相对的 `file:` 依赖。
- 不要把 `@jsbot-tellus/core` 写进 `dependencies` 或 `peerDependencies`；宿主会在 `plugins/<目录>/node_modules/@jsbot-tellus/core` 创建链接，运行时直接解析到当前内核。
- 安装器默认使用 `--ignore-scripts`；只有配置 `installer.allowScripts=true` 才会执行 npm 脚本。

一个可发布的 `package.json` 示例：

```json
{
    "name": "@yourscope/plugin-demo",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": {
            "types": "./dist/index.d.ts",
            "import": "./dist/index.js"
        }
    },
    "files": ["dist"],
    "scripts": {
        "build": "tsc -p tsconfig.json",
        "prepack": "npm run build"
    },
    "devDependencies": {
        "@jsbot-tellus/core": "^2.0.3",
        "@types/node": "^24.6.4",
        "typescript": "^7.0.2"
    },
    "dependencies": {
        "zod": "^4.6.7"
    }
}
```

发布后在聊天中安装：

```text
/plugin install @yourscope/plugin-demo@1.0.0
/plugin install @yourscope/plugin-demo@latest
/plugin list
/plugin update @yourscope/plugin-demo
/plugin remove @yourscope/plugin-demo
```

安装器限制：

- 只接受 npm registry 包，不接受本地路径、`file:`、`workspace:`、`link:`、git/github 地址或 `http(s)` URL。
- 版本只接受精确版本或 dist-tag，不接受 `^`、`~`、`1.x` 等范围。
- `/plugin` 的所有子命令都要求 SuperAdmin，安装器默认关闭。
- 安装后会直接落在 `plugins/<插件id>/`（多插件包使用包名目录），运行时依赖在该目录的 `node_modules`。`plugins/.jsbot-installed.json` 由内核维护，不要手动修改。目标目录已被手动放置的本地插件占用时，安装会被拒绝。
- 安装、更新、卸载成功后会自动重建运行时；进程本身不会退出。

## 安全边界

插件和内核运行在同一个 Node.js 进程中，不是安全沙箱。插件可以访问文件系统、网络和 `process.env`，也可以执行任意代码。只加载和安装完全信任的插件；生产环境建议配置 `installer.allowedPackages`，并保持 `installer.allowScripts=false`。

## 开发检查清单

- 插件目录位置符合约定：本地插件在 `plugins/<id>/`，内置插件在 `src/plugins/<id>/`。
- `manifest.id` 唯一；发布到 npm 时符合 `[a-z0-9][a-z0-9._-]*` 格式。
- `configSchema` 使用 `.strict()`，默认值完整。
- TypeScript 构建通过，运行时加载的是 `dist`。
- 命令名是单个路径段；多级命令使用 `ctx.commands.group()`。
- 命令权限和群组 gating 符合预期。
- 重启进程后插件仍能正常加载。
- 发布包不包含本地绝对路径、`file:` 依赖或对 `@jsbot-tellus/core` 的运行时依赖。
