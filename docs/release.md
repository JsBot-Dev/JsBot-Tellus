# 发布流程

`@jsbot-tellus/core` 通过 GitHub Actions 自动发布：

- CI 工作流：[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml)，负责类型检查、格式检查、依赖审计、测试、构建、smoke 和 Docker 镜像构建校验
- CD 工作流：[`.github/workflows/cd.yaml`](../.github/workflows/cd.yaml)，在 `main` 的 CI 成功后发布到 npm，并构建推送 Docker 镜像
- 触发方式：推送到 `main`，或在 `main` 上手动运行 `CI`；不需要创建或推送版本标签
- 发布方式：npm Trusted Publisher（GitHub OIDC），不需要长期 `NPM_TOKEN`
- Docker 镜像：同时推送 GHCR 和 Docker Hub；使用 `GITHUB_TOKEN` 推送 GHCR，Docker Hub 使用仓库 Secret
- 幂等处理：`package.json` 中的版本已经存在于 npm 时跳过 npm 发布；同版本镜像已存在于某个镜像仓库时只跳过该仓库
- 发布产物带 npm provenance；Docker 镜像带 provenance 和 SBOM

CD 只会在 CI 结论为成功、且 CI 运行来自 `main` 的 `push` 或 `workflow_dispatch` 时执行。`pull_request` 运行和其他分支不会触发发布。

## 一次性配置

在 npm 上打开 `@jsbot-tellus/core` 的包设置，配置 Trusted Publisher：

| 字段                 | 值             |
| -------------------- | -------------- |
| Provider             | GitHub Actions |
| Organization or user | `JsBot-Dev`    |
| Repository           | `JsBot-Tellus` |
| Workflow filename    | `cd.yaml`      |
| Environment          | 留空           |

工作流文件名必须与实际文件一致。如果以后重命名 `cd.yaml`，需要同步修改 npm 的 Trusted Publisher 配置。

Docker Hub 需要在仓库的 **Settings → Secrets and variables → Actions** 中配置：

| Secret               | 值                                      |
| -------------------- | --------------------------------------- |
| `DOCKERHUB_USERNAME` | Docker Hub 用户名                       |
| `DOCKERHUB_TOKEN`    | Docker Hub Access Token（Read & Write） |

首次镜像推送后，如果希望匿名拉取，在 GitHub 仓库的 **Packages** 设置里把 `jsbot-tellus` 的可见性改为 public。GHCR 使用工作流自带的 `GITHUB_TOKEN`，不需要额外 Secret。

CD 工作流已经声明：

```yaml
permissions:
    contents: read
    id-token: write
    packages: write
```

`id-token: write` 用于 npm OIDC 和 provenance，不能删除；`packages: write` 用于推送 GHCR。

## 发布新版本

发布前先在功能分支提升版本并更新 lockfile：

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v$(node -p "require('./package.json').version")"
git push
```

将 `patch` 换成 `minor` 或 `major` 可以发布对应版本。提交并通过 Pull Request 合并到 `main` 后，CI 会先运行；CI 成功后 CD 自动发布该版本到 npm，并构建推送 Docker 镜像。`main` 受分支保护，不能直接推送。

如果 `main` 上的版本已经在 npm 存在，CD 只会输出提示并跳过，不会失败。镜像按仓库独立判断：某个仓库已有该版本时跳过该仓库，缺失的仓库会补推。版本提交重复合并不影响已发布版本。

## Docker 镜像

CD 会推送以下标签：

- `latest`
- 完整版本号，例如 `1.2.3`
- 主次版本，例如 `1.2`
- 主版本，例如 `1`
- `sha-<短哈希>`

镜像地址：

- `ghcr.io/jsbot-dev/jsbot-tellus`
- `docker.io/<DOCKERHUB_USERNAME>/jsbot-tellus`

只构建 `linux/amd64`。CI 在每次推送时构建镜像并执行 smoke，但不会推送。使用方式见 [Docker 部署](docker.md)。

## 手动运行

在 GitHub Actions 中打开 `CI`，选择 `Run workflow`，并选择 `main` 分支。CI 成功后，CD 会像普通推送一样自动发布。

如果 CD 因临时故障失败，可以在 Actions 中打开对应的 `CD` 运行并选择 `Re-run failed jobs`，不需要重新推送代码。Docker job 会重新检查两个镜像仓库，只补推缺失的版本标签。

## 验证

发布完成后检查：

```bash
npm view @jsbot-tellus/core version
npm view @jsbot-tellus/core dist-tags
```

正式安装验证：

```bash
npm install -g @jsbot-tellus/core@latest
jsbot --help
```

Docker 镜像验证：

```bash
docker pull ghcr.io/jsbot-dev/jsbot-tellus:latest
docker run --rm ghcr.io/jsbot-dev/jsbot-tellus:latest --help

docker pull <DOCKERHUB_USERNAME>/jsbot-tellus:latest
docker run --rm <DOCKERHUB_USERNAME>/jsbot-tellus:latest --help
```

## 常见失败

- **`ENEEDAUTH` / `E403`**：检查 npm Trusted Publisher 的组织、仓库和工作流文件名是否完全匹配（文件名必须是 `cd.yaml`）。
- **`npm publish` 提示版本已存在**：说明该版本此前已经发布；提升 `package.json` 版本后重新推送到 `main`。正常情况下 CD 会自动跳过已发布版本。
- **provenance 失败**：确认 CD 工作流仍有 `id-token: write` 权限，并且仓库是公开的。
- **Docker Hub 登录失败 / `unauthorized`**：确认 `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` 已配置，Token 有 Read & Write 权限。
- **GHCR 推送 `denied`**：确认工作流仍有 `packages: write`，并且组织没有禁止 `GITHUB_TOKEN` 创建包。
- **镜像已存在**：CD 会输出 notice 并跳过对应仓库，不会失败；如果两个仓库都有该版本，提升版本号后再发布。
- **Docker job 被跳过**：它依赖 npm 发布 job；npm 发布失败或 CD 未在 `main` 触发时不会执行。
- **CD 没有触发**：确认 `CI` 已在 `main` 上成功完成；`pull_request` 运行和其他分支不会触发发布。
- **CD 找不到要发布的提交**：确认 `ci.yaml` 和 `cd.yaml` 都已经在默认分支上。
