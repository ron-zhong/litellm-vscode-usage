# Changelog

All notable changes to the **LiteLLM Usage** VS Code extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Unit tests using a real local HTTP mock server for `fetchUserInfo` and `fetchSpendLogs` (7 new tests; 19 total).
- Integration test suite (`npm run test:integration`) that runs against a live LiteLLM proxy and skips gracefully when `LITELLM_API_BASE` is not set.
- End-to-end test suite (`npm run test:e2e`) using `@vscode/test-electron` that verifies extension activation and command registration inside a real VS Code instance.
- GitHub Actions workflows: CI (`ci.yml`), CodeQL SAST (`codeql.yml`), and automated marketplace publish (`publish.yml`).
- Dependabot configuration for weekly npm and GitHub Actions dependency updates.
- `CONTRIBUTING.md` developer guide.
- `CHANGELOG.md` (this file).

---

## [0.2.0] — Reduce scope to focus on Usage Dashboard only

### Removed
- `LiteLLM: Configure VS Code Chat (BYOK)` command — the extension no longer modifies VS Code Chat / Copilot settings.
- `LiteLLM: Configure AI Models` command and the model-picker wizard for VS Code Chat / Claude Code.
- `LiteLLM: Generate Commit Message` command and the ✨ Source Control input-box button.
- `litellm.defaultModel` setting (only consumed by the removed commands above).
- Supporting code: `generateCommitMessageFromDiff` and `fetchAvailableModels` HTTP helpers and their unit/integration tests.

---

## [0.1.0] — Initial release

### Added
- Status-bar spend badge showing the current monthly LiteLLM spend, refreshed on a configurable interval.
- `LiteLLM: Show Current Spend Details` quick-pick popup with budget bar, today's spend, reset date, and user ID.
- `LiteLLM: Show Usage Dashboard` webview with daily and model-level spend tables.
- `LiteLLM: Configure VS Code Chat (BYOK)` command to wire VS Code Chat and Copilot to a LiteLLM proxy.
- `LiteLLM: Refresh Status Bar` command to force-refresh spend data.
- Settings: `litellm.apiBase`, `litellm.apiKey`, `litellm.refreshIntervalSeconds`, `litellm.defaultModel`.
- Fallback to `LITELLM_API_BASE` / `LITELLM_API_KEY` environment variables.
- Unit tests for `aggregateUsage`, `today`, and `startOfMonth`.

[Unreleased]: https://github.com/ron-zhong/litellm-vsix/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ron-zhong/litellm-vsix/releases/tag/v0.1.0