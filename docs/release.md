# 发布流程

`@jsbot-tellus/core` 通过 GitHub Actions 自动发布：

- CI 工作流：[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml)，负责类型检查、格式检查、依赖审计、测试、构建和 smoke
- CD 工作流：[`.github/workflows/cd.yaml`](../.github/workflows/cd.yaml)，在 `main` 的 CI 成功后发布到 npm
- 触发方式：推送到 `main`，或在 `main` 上手动运行 `CI`；不需要创建或推送版本标签
- 发布方式：npm Trusted Publisher（GitHub OIDC），不需要长期 `NPM_TOKEN`
- 幂等处理：如果 `package.json` 中的版本已经存在于 npm，发布步骤会跳过
- 发布产物带 npm provenance

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

CD 工作流已经声明：

```yaml
permissions:
    contents: read
    id-token: write
```

`id-token: write` 用于 OIDC 和 provenance，不能删除。

## 发布新版本

发布前先在功能分支提升版本并更新 lockfile：

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v$(node -p "require('./package.json').version")"
git push
```

将 `patch` 换成 `minor` 或 `major` 可以发布对应版本。合并到 `main`（或直接推送到 `main`）后，CI 会先运行；CI 成功后 CD 自动发布该版本。

如果 `main` 上的版本已经在 npm 存在，CD 只会输出提示并跳过，不会失败。因此重复推送 `main` 是安全的。

## 手动运行

在 GitHub Actions 中打开 `CI`，选择 `Run workflow`，并选择 `main` 分支。CI 成功后，CD 会像普通推送一样自动发布。

如果 CD 因临时故障失败，可以在 Actions 中打开对应的 `CD` 运行并选择 `Re-run failed jobs`，不需要重新推送代码。

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

- **`ENEEDAUTH` / `E403`**：检查 npm Trusted Publisher 的组织、仓库和工作流文件名是否完全匹配（文件名必须是 `cd.yaml`）。
- **`npm publish` 提示版本已存在**：说明该版本此前已经发布；提升 `package.json` 版本后重新推送到 `main`。正常情况下 CD 会自动跳过已发布版本。
- **provenance 失败**：确认 CD 工作流仍有 `id-token: write` 权限，并且仓库是公开的。
- **CD 没有触发**：确认 `CI` 已在 `main` 上成功完成；`pull_request` 运行和其他分支不会触发发布。
- **CD 找不到要发布的提交**：确认 `ci.yaml` 和 `cd.yaml` 都已经在默认分支上。
