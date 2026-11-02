# Docker 部署

Docker 镜像包含内核、内置插件、WebUI 静态资源和生产依赖，不包含配置、数据库和本地插件。这几项通过卷挂载持久化。

## 镜像

| 仓库       | 镜像                                          |
| ---------- | --------------------------------------------- |
| GHCR       | `ghcr.io/jsbot-dev/jsbot-tellus`              |
| Docker Hub | `docker.io/<DOCKERHUB_USERNAME>/jsbot-tellus` |

当前只提供 `linux/amd64`。标签规则：

| 标签          | 说明                            |
| ------------- | ------------------------------- |
| `latest`      | 最近一次成功发布的新版本        |
| `1.2.3`       | 完整版本号，对应 `package.json` |
| `1.2`、`1`    | 主/次版本                       |
| `sha-xxxxxxx` | 对应提交的短哈希                |

同一个版本已经存在于某个镜像仓库时，CD 会跳过该仓库，不覆盖已有版本标签。`latest` 只会在发布新版本时移动。

## 快速开始

先准备配置目录。配置文件必须放在一个目录里挂载，不要单独挂载 `bot.config.json` 文件：WebUI 保存配置时会先写临时文件再原子重命名，单文件挂载会导致重命名失败。

```bash
mkdir -p config
cp bot.config.example.json config/bot.config.json
```

本地没有源码时，可以直接从镜像取出示例配置：

```bash
docker run --rm --entrypoint cat \
  ghcr.io/jsbot-dev/jsbot-tellus:latest \
  /app/bot.config.example.json > config/bot.config.json
```

编辑 `config/bot.config.json`，至少填写 OneBot 的 `url`、`accessToken` 和 `roles`。然后使用仓库里的示例：

```bash
docker compose -f compose.example.yaml up -d
```

或者直接运行：

```bash
docker run -d --name jsbot \
  --restart unless-stopped \
  --init \
  -p 127.0.0.1:8787:8787 \
  -v "$PWD/config:/app/config" \
  -v jsbot-data:/app/data \
  -v jsbot-plugins:/app/plugins \
  ghcr.io/jsbot-dev/jsbot-tellus:latest
```

查看日志：

```bash
docker compose -f compose.example.yaml logs -f
# 或
docker logs -f jsbot
```

## 路径和卷

镜像内固定使用以下路径：

| 容器路径          | 内容               | 说明                                              |
| ----------------- | ------------------ | ------------------------------------------------- |
| `/app/config`     | 配置文件目录       | 环境变量 `BOT_CONFIG=/app/config/bot.config.json` |
| `/app/data`       | SQLite 数据库      | 环境变量 `BOT_DATA_DIR=/app/data`                 |
| `/app/plugins`    | 本地和在线安装插件 | 固定目录，不可通过环境变量修改                    |
| `/app/dist/webui` | WebUI 静态资源     | 随镜像构建                                        |

`data` 和 `plugins` 建议使用命名卷；如果改成宿主目录，需要保证容器内用户可写。

容器以非 root 的 `node` 用户运行，UID/GID 为 `1000:1000`。绑定宿主机目录时先授权：

```bash
mkdir -p data plugins
sudo chown -R 1000:1000 data plugins config
```

## WebUI

WebUI 默认关闭。容器内要让端口可达，配置需要监听 `0.0.0.0`：

```json
{
    "webui": {
        "enabled": true,
        "host": "0.0.0.0",
        "port": 8787,
        "username": "admin",
        "password": "至少 8 位"
    }
}
```

示例 compose 只把端口发布到宿主机 `127.0.0.1`。WebUI 是完全特权接口，远程访问请放在 HTTPS 反向代理后面，不要直接暴露到公网。反向代理时按需设置 `trustProxy`，详见 [WebUI 文档](webui.md)。

不启用 WebUI 时可以删掉 compose 里的 `ports`，或者不传 `-p`。

## 插件

`plugins` 卷必须可写。在线安装器默认关闭；启用后 `/plugin install` 会在容器内调用 npm，把包安装到 `/app/plugins/<id>/`，因此容器需要能访问 npm registry：

```json
{
    "installer": {
        "enabled": true,
        "registry": "https://registry.npmjs.org/"
    }
}
```

手动放入的本地插件也从 `/app/plugins/<id>/dist` 加载，并在每次启动或重启时尝试重建。镜像已经包含 npm；插件自己的依赖安装在各自的 `node_modules` 中，不需要把宿主机的 `node_modules` 挂进来。

## 升级

```bash
docker compose -f compose.example.yaml pull
docker compose -f compose.example.yaml up -d
```

需要固定版本时把镜像标签改成完整版本号，例如 `ghcr.io/jsbot-dev/jsbot-tellus:1.2.3`。升级前建议备份 `/app/data` 和 `/app/config`。

## 本地构建

```bash
docker build -t jsbot-tellus .
docker run --rm jsbot-tellus --help
```

本地开发时也可以直接挂载配置启动：

```bash
docker run --rm -it \
  -v "$PWD/config:/app/config" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/plugins:/app/plugins" \
  jsbot-tellus
```

## 发布机制

Docker 镜像由 [`.github/workflows/cd.yaml`](../.github/workflows/cd.yaml) 发布：

- `main` 的 CI 成功、并且 npm 发布步骤成功或幂等跳过之后执行；
- 同时推送 GHCR 和 Docker Hub；
- 每个仓库独立检查版本标签，已存在则跳过，缺失的一侧会补推；
- 构建带 GHA 缓存、provenance 和 SBOM，仅 `linux/amd64`。

GHCR 使用 `GITHUB_TOKEN` 和 `packages: write`，不需要额外 Secret。Docker Hub 需要在仓库 Actions secrets 中配置 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`（Read & Write Token）。CI 会在每次推送时构建镜像并做 smoke，但不会推送。完整发布流程见[发布流程](release.md)。

## 故障排查

- **启动提示找不到配置**：确认 `./config/bot.config.json` 存在，并且挂载到 `/app/config`。
- **`EACCES` / `permission denied`**：确认宿主机上的 `config`、`data`、`plugins` 目录属于 UID 1000，或改用命名卷。
- **WebUI 打不开**：确认配置里 `webui.enabled=true`、`host=0.0.0.0`，并且容器端口已发布到宿主机。
- **在线安装插件失败**：确认 `installer.enabled=true`、容器能访问 registry，并且 `/app/plugins` 可写。
- **GHCR 拉取 403/404**：首次发布后到仓库的 Packages 设置里把 `jsbot-tellus` 设为 public，或先 `docker login ghcr.io`。
- **镜像架构不匹配**：当前镜像只有 `linux/amd64`，ARM 设备需要使用 amd64 模拟或自行构建。
