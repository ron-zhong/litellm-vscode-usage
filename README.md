# LiteLLM Usage — VS Code Extension

Monitor your [LiteLLM](https://github.com/BerriAI/litellm) proxy spend directly in VS Code.

---

## Features

| Feature | Description |
|---|---|
| **Status-bar spend** | Live monthly spend badge, refreshed on a configurable interval. |
| **Spend details** | Quick-pick popup with today's spend, monthly spend, budget %, and reset date. |
| **Usage Dashboard** | Webview with daily & model-level spend tables. |

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
  "litellm.refreshIntervalSeconds": 300
}
```

Environment variables (`LITELLM_API_BASE`, `LITELLM_API_KEY`) are read at startup and serve as fallbacks for users who prefer not to store credentials in VS Code settings.

---

## Commands

| Command | Description |
|---|---|
| `LiteLLM: Show Usage Dashboard` | Open the webview spend dashboard |
| `LiteLLM: Show Current Spend Details` | Quick-pick spend popup |
| `LiteLLM: Refresh Status Bar` | Force-refresh the spend badge |

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
# Unit tests only — no network, no VS Code required (19 tests)
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
| **Credential hygiene** | The extension never logs API keys. Credentials are stored only in VS Code settings or environment variables and are sent solely to your configured LiteLLM proxy. |

---

## License

[MIT](LICENSE)

