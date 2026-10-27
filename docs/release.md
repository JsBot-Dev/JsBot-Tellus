# 发布流程

`@jsbot-tellus/core` 通过 GitHub Actions 的 CD 流程发布：

- 工作流：[`.github/workflows/cd.yaml`](../.github/workflows/cd.yaml)
- 触发方式：推送 `v*` 标签，或手动运行
- 发布方式：npm Trusted Publisher（GitHub OIDC），不需要长期 `NPM_TOKEN`
- 发布前会执行类型检查、格式检查、测试、构建、CLI smoke 和 `npm pack --dry-run`
- 发布产物带 npm provenance

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

工作流已经声明：

```yaml
permissions:
    contents: read
    id-token: write
```

`id-token: write` 用于 OIDC 和 provenance，不能删除。

## 发布当前版本

确认 `main` 已包含要发布的提交，且 `package.json` 的版本为 `2.0.2`，然后创建并推送标签：

```bash
git switch main
git pull --ff-only
git tag v2.0.2
git push origin v2.0.2
```

标签必须和 `package.json` 的 `version` 完全一致，否则工作流会在发布前失败。

## 发布后续版本

```bash
git switch main
git pull --ff-only
npm version patch -m "Release v%s"
git push origin main --follow-tags
```

将 `patch` 换成 `minor` 或 `major` 可以发布对应版本。`npm version` 会同时更新 `package.json`、`package-lock.json`，创建提交和标签。

## 手动运行

在 GitHub Actions 中打开 `CD`，选择 `Run workflow`：

- `dry_run: true`（默认）：只执行检查、构建和打包预演，不发布。
- `dry_run: false`：执行完整流程并发布当前分支上的版本。

手动发布前请确认当前分支的版本尚未发布，且确实需要绕过标签流程。

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

## 常见失败

- **标签与版本不一致**：先修改 `package.json` 版本，再重新打标签。
- **`ENEEDAUTH` / `E403`**：检查 npm Trusted Publisher 的仓库、组织和工作流文件名是否完全匹配。
- **`npm publish` 提示版本已存在**：npm 不允许覆盖已发布版本，需要提升版本后重新打标签。
- **provenance 失败**：确认工作流仍有 `id-token: write` 权限，并且仓库是公开的。
