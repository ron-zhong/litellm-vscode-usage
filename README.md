# LiteLLM Usage — VS Code Extension

Monitor your [LiteLLM](https://github.com/BerriAI/litellm) proxy spend directly in VS Code and unlock AI-powered developer productivity features powered by your own LiteLLM endpoint.

---

## Features

| Feature | Description |
|---|---|
| **Status-bar spend** | Live monthly spend badge, refreshed on a configurable interval. |
| **Spend details** | Quick-pick popup with today's spend, monthly spend, budget %, and reset date. |
| **Usage Dashboard** | Webview with daily & model-level spend tables. |
| **VS Code Chat BYOK** | One-click configuration of VS Code Chat to use your LiteLLM proxy. |
| **Configure AI Models** | Fetch your proxy's model list and apply one model to VS Code Chat and/or Claude Code in a single wizard. |
| **Generate Commit Message** | ✨ button in the Source Control input box — generates a conventional commit message from your staged diff. |

---

## Requirements

- VS Code **1.85.0** or newer
- A running [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/quick_start) (`http://localhost:4000` by default)

---

## Installation

### From the Marketplace

Search **LiteLLM Usage** in the VS Code Extensions view, or open it directly:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=litellm.litellm-usage)
- [Open VSX Registry](https://open-vsx.org/extension/litellm/litellm-usage)

### From a local `.vsix` file

```bash
code --install-extension litellm-usage-*.vsix
```

---

## Configuration

Open **Settings → Extensions → LiteLLM Usage** or add the following to your `settings.json`:

```jsonc
{
  // Required: base URL of your LiteLLM proxy (no trailing slash).
  // Falls back to the LITELLM_API_BASE environment variable.
  "litellm.apiBase": "http://localhost:4000",

  // Optional: your LiteLLM API key.
  // Falls back to the LITELLM_API_KEY environment variable.
  "litellm.apiKey": "sk-...",

  // How often (in seconds) to refresh the status-bar badge. Minimum: 30.
  "litellm.refreshIntervalSeconds": 300,

  // Default model used for commit-message generation and BYOK chat config.
  // Updated automatically by "LiteLLM: Configure AI Models".
  "litellm.defaultModel": "gpt-4o"
}
```

Environment variables (`LITELLM_API_BASE`, `LITELLM_API_KEY`) are read at startup and serve as fallbacks for users who prefer not to store credentials in VS Code settings.

---

## Commands

| Command | Description |
|---|---|
| `LiteLLM: Show Usage Dashboard` | Open the webview spend dashboard |
| `LiteLLM: Show Current Spend Details` | Quick-pick spend popup |
| `LiteLLM: Configure VS Code Chat (BYOK)` | Wire VS Code Chat to your LiteLLM proxy |
| `LiteLLM: Configure AI Models` | Select a model for VS Code Chat and/or Claude Code |
| `LiteLLM: Refresh Status Bar` | Force-refresh the spend badge |
| `LiteLLM: Generate Commit Message` | Generate a commit message from staged changes |

---

## Feature guide

### Configure AI Models

**Command palette → `LiteLLM: Configure AI Models`**

The wizard:
1. Fetches all models available on your LiteLLM proxy (`/v1/models`).
2. Lets you pick one (or type a custom model ID if the fetch fails).
3. Asks which AI client(s) to configure — **VS Code Chat**, **Claude Code**, or **Both**.
4. Asks whether to save to User or Workspace settings.

**VS Code Chat** — writes `litellm.defaultModel`, `github.copilot.advanced`, and `chat.openaiCompatibleChatModels` so that Copilot Chat and VS Code's built-in OpenAI-compatible chat both route through LiteLLM.

**Claude Code** — writes (or merges into) `.claude/settings.json` (project) or `~/.claude/settings.json` (global) with:

```jsonc
{
  "model": "gpt-4o",          // the model you selected
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4000",
    "ANTHROPIC_API_KEY": "sk-..."
  }
}
```

Claude Code picks up `ANTHROPIC_BASE_URL` to proxy requests through LiteLLM. The `model` field overrides the default model for that project or globally.

> **Security note**: if your LiteLLM API key is written to a project-scoped `.claude/settings.json`, the extension reminds you to add `.claude/settings.json` to `.gitignore` to avoid committing credentials.

### Generate Commit Message

Stage some files, then click the ✨ button in the Source Control panel next to the commit message text box (or run `LiteLLM: Generate Commit Message` from the command palette). The extension sends the staged diff to LiteLLM and writes a conventional commit message directly into the input box.

### Configure VS Code Chat (BYOK)

Run `LiteLLM: Configure VS Code Chat (BYOK)` to write the endpoint and model into VS Code's Copilot and built-in chat settings. Reload VS Code when prompted for changes to take effect.

---

## Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Setup

```bash
git clone https://github.com/ron-zhong/litellm-vsix.git
cd litellm-vsix
npm install
```

### Build

```bash
npm run compile      # one-off TypeScript compile
npm run watch        # incremental watch mode
```

### Lint

```bash
npm run lint
```

### Tests

```bash
# Unit tests only — no network, no VS Code required (31 tests)
npm run test:unit

# Unit + integration tests
# Integration tests skip automatically when LITELLM_API_BASE is not set.
npm test

# Integration tests against a live LiteLLM proxy
LITELLM_API_BASE=http://localhost:4000 LITELLM_API_KEY=sk-... npm run test:integration

# End-to-end tests — downloads VS Code, requires a display or xvfb on Linux
npm run test:e2e
# On headless Linux: xvfb-run -a npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full development guide.

### Package

```bash
npm run package      # produces litellm-usage-*.vsix
```

---

## Publishing

The extension is published to two registries:

| Registry | URL |
|---|---|
| VS Code Marketplace | <https://marketplace.visualstudio.com/items?itemName=litellm.litellm-usage> |
| Open VSX Registry | <https://open-vsx.org/extension/litellm/litellm-usage> |

### Prerequisites

1. **VS Code Marketplace** — create a publisher account at <https://marketplace.visualstudio.com/manage> and generate a Personal Access Token (PAT) with the *Marketplace → Manage* scope.
2. **Open VSX** — create an account at <https://open-vsx.org> and generate a token under *User Settings → Access Tokens*.
3. Install the publishing tools:

```bash
npm install -g @vscode/vsce ovsx
```

### Manual publishing (hotfix / first release)

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Publish to VS Code Marketplace (packages automatically)
vsce publish --pat <VSCE_PAT>

# 3. Publish to Open VSX
ovsx publish litellm-usage-*.vsix --pat <OVSX_PAT>
```

### Automated publishing via GitHub Actions

Push a version tag to trigger the [publish workflow](.github/workflows/publish.yml):

```bash
git tag v1.2.3
git push origin v1.2.3
```

#### Required repository secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VSCE_PAT` | VS Code Marketplace Personal Access Token |
| `OVSX_PAT` | Open VSX Personal Access Token |

The workflow installs dependencies, runs unit tests, and publishes to both registries in a single job.

#### First-time Open VSX namespace

Open VSX requires you to claim the namespace once before the first publish:

```bash
ovsx create-namespace litellm --pat <OVSX_PAT>
```

---

## Security & Compliance

| Control | Details |
|---|---|
| **SAST** | [CodeQL](https://codeql.github.com/) runs on every push, pull request, and weekly schedule — see [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml). |
| **Dependency scanning** | `npm audit --audit-level=high` runs in CI; [Dependabot](.github/dependabot.yml) opens automated PRs for npm packages and GitHub Actions updates weekly. |
| **Secret scanning** | GitHub's built-in secret scanning is enabled for the repository. |
| **Credential hygiene** | The extension never logs API keys. When writing project-scoped Claude Code settings it warns users to gitignore the file. |

---

## License

[MIT](LICENSE)

