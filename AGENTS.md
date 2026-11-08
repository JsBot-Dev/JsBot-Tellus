# AGENTS.md

## Repository

- Single npm package (`@jsbot-tellus/core`), no npm workspaces. ESM + NodeNext + strict TypeScript.
- Requires Node `^24.22.1 || >=26.12.1`. Kernel lives in `src/core/`, built-in plugins in `src/plugins/`, entrypoint is `src/app.ts`.
- `dist/` is generated and gitignored; never edit it. Config, data, and plugins resolve from `process.cwd()`: `./bot.config.jsonc`, `./data`, `./plugins`. Real `*.config.json` / `*.config.jsonc`, `data/`, and `plugins/` are gitignored.

## Commands

- Setup: `npm ci`, then `cp bot.config.example.jsonc bot.config.jsonc`.
- Source dev: `npm run dev` (tsx watch for `src/` and `plugins/*/src`, ignores `plugins/*/dist`); one-shot: `npm run start:source`.
- Built run: `npm run build` (cleans `dist`, builds WebUI, then `tsc`) followed by `npm start`. `npm run smoke` only checks `dist/app.js --help`.
- Type checks: `npm run check` (kernel/tests/scripts), `npm run check:webui`, `npm run check:all` (also local plugins). There is no ESLint; formatting is Prettier (`npm run format:check`, `npm run format`).
- WebUI dev: `npm run dev:webui` serves Vite on port 5173 and proxies `/api` to a backend on `127.0.0.1:8787`; run the backend separately.

## Before committing

- Before committing, bump the version in `package.json` according to Semantic Versioning (and update the lockfile in the same commit), e.g. `npm version patch|minor|major --no-git-tag-version`.

## Tests

- `npm test` runs all Vitest tests once. Single file: `npx vitest run tests/kernel/router.test.ts`; add `-t "<name>"` for one case.
- `tests/webui-csp.test.ts` reads `dist/webui/index.html`, so run `npm run build` before tests on a fresh clone or after changing `webui/index.html`. CI builds before testing.
- Use `createTestApp` from `tests/helpers/test-app.ts` (FakeClient + in-memory SQLite) for kernel/plugin tests instead of real WebSocket or disk DB. Installer tests use a fake npm runner/validator; `install-validate.test.ts` spawns a real subprocess.

## Architecture

- The kernel owns config, the SDK connection, router/dispatch, permissions/gating, messaging, SQLite, and WebUI. Built-in plugins are ordinary source compiled by `npm run build`; register new ones in `src/plugins/index.ts`.
- Plugins must not import the SDK client, `Router`, or the database directly; use `PluginContext`, `EventContext`, and `BotApi`. `src/core/` must not import `src/plugins/`.
- `setup()` only registers commands/events/middleware; create timers and network resources in `start()` and clean them up in `stop()`. Use `ctx.commands.group()` for multi-level commands; command names cannot contain spaces.
- NodeNext requires `.js` extensions in relative TypeScript imports. The public plugin API is `src/core/index.ts`; Vitest aliases `@jsbot-tellus/core` to it.

## Local plugins

- `plugins/` is gitignored and may contain user-only work; do not delete or commit it. Local/npm plugins are independent packages loaded from `plugins/<id>/dist` after built-ins; duplicate IDs keep the built-in/first plugin.
- The loader accepts `default`, named `plugin`, or `plugins` exports and ignores `.d.ts` and `node_modules`. On every load it rebuilds plugins that declare a `build` script, have `node_modules`, and contain build sources (`tsconfig.json` or `src/`); prebuilt packages that only ship `dist` are loaded as-is. A failed rebuild falls back to an existing `dist`; with no usable `dist`, the plugin is skipped.
- Root `npm run build` does not build local plugins. Use `npm run build:plugin` / `npm run check:plugin` (auto-discovers packages with `src/`, `tsconfig.json`, and the matching script; skips missing `node_modules`), or `npm run build --prefix plugins/<id>`.
- Scaffold with `npm run plugin:gen -- my-plugin` (installs dependencies unless `--no-install`).
- Plugin configs live in `<data-dir>/config/plugin/<id>.jsonc` (JSONC, one file per plugin, including `enabled`, `private`, `groups`, and plugin options). A legacy `plugins` field in `bot.config.jsonc` is ignored with a warning and removed on the next WebUI save; it is not auto-migrated. Missing/invalid plugin configs only warn and skip that plugin; core config errors stay fatal.
- Root `format:check` ignores `plugins/`; use `npm run format:plugin:check` or `npm run format:plugin` for local plugin files.
- Runtime restart re-imports plugin entry modules, but helper modules can remain ESM-cached; fully restart the process for reliable multi-file plugin changes.

## Release

- CD publishes npm and Docker only after CI succeeds on protected `main`; no tags are used. Bump `package.json` + lockfile (`npm version patch --no-git-tag-version`) in a PR; an already-published version is skipped.
- Detailed docs: `docs/architecture.md`, `docs/plugin-development.md`, `docs/plugin-api.md`, `docs/configuration.md`, `docs/webui.md`, `docs/release.md`.
