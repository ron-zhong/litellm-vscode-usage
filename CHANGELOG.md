# Changelog

All notable changes to the **LiteLLM Usage** VS Code extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `LiteLLM: Configure AI Models` command — fetches available models from `/v1/models`, presents a picker, and applies the chosen model to VS Code Chat (Copilot BYOK + `chat.openaiCompatibleChatModels`) and/or Claude Code (`.claude/settings.json`).
- `LiteLLM: Generate Commit Message` command — ✨ sparkle button in the Source Control input box; generates a conventional commit message from the staged diff using LiteLLM's chat completions endpoint.
- Unit tests using a real local HTTP mock server for `generateCommitMessageFromDiff`, `fetchUserInfo`, `fetchSpendLogs`, and `fetchAvailableModels` (19 new tests; 31 total).
- Integration test suite (`npm run test:integration`) that runs against a live LiteLLM proxy and skips gracefully when `LITELLM_API_BASE` is not set.
- End-to-end test suite (`npm run test:e2e`) using `@vscode/test-electron` that verifies extension activation and command registration inside a real VS Code instance.
- GitHub Actions workflows: CI (`ci.yml`), CodeQL SAST (`codeql.yml`), and automated marketplace publish (`publish.yml`).
- Dependabot configuration for weekly npm and GitHub Actions dependency updates.
- `CONTRIBUTING.md` developer guide, including a post-lint security-audit step that runs `npm audit` and requires zero CRITICAL/HIGH vulnerabilities before a PR can merge.
- `CHANGELOG.md` (this file).

### Security
- Added an npm `overrides` block forcing `brace-expansion` (`^5.0.8`) and `serialize-javascript` (`^7.0.5`) to eliminate high-severity transitive vulnerabilities pulled in via mocha; `npm audit` now reports 0 vulnerabilities. Preferred over `npm audit fix --force`, which would have downgraded mocha to 8.1.3.

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
