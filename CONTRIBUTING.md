# Contributing to LiteLLM Usage

Thank you for your interest in contributing! This guide covers how to set up the development environment, run tests, and submit changes.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Testing](#testing)
- [Debugging in VS Code](#debugging-in-vs-code)
- [Adding a new command](#adding-a-new-command)
- [Submitting a pull request](#submitting-a-pull-request)

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 18 |
| npm | 9 |
| VS Code | 1.85.0 |

---

## Setup

```bash
git clone https://github.com/ron-zhong/litellm-vsix.git
cd litellm-vsix
npm install
```

---

## Project structure

```
src/
  extension.ts        # Entry point — activation, command registration
  config.ts           # Reads litellm.* settings + env-var fallbacks
  litellmClient.ts    # HTTP client + data aggregation functions
  usagePanel.ts       # Usage Dashboard webview

  test/
    litellmClient.test.ts              # Unit tests — aggregation helpers
    httpClient.unit.test.ts            # Unit tests — HTTP client (mock server)
    integration/
      litellm.integration.test.ts      # Integration tests — real LiteLLM proxy
    e2e/
      runTests.ts                      # E2E runner (@vscode/test-electron)
      suite/
        index.ts                       # Mocha suite loader (runs inside VS Code)
        extension.test.ts              # E2E tests

.github/
  workflows/
    ci.yml            # Lint, compile, audit, unit/integration/E2E tests, VSIX artifact
    codeql.yml        # CodeQL SAST (push, PR, weekly schedule)
    publish.yml       # Publish to Marketplace + Open VSX on version tag
  dependabot.yml      # Automated npm + Actions dependency updates
```

---

## Development workflow

### Compile

```bash
npm run compile   # once
npm run watch     # watch mode (recommended during development)
```

### Lint

```bash
npm run lint
```

Lint runs automatically in CI and must pass before a PR can be merged.

### Security audit

After linting, verify the dependency tree is free of known vulnerabilities:

```bash
npm install 2>&1 | tail -15 && echo "=== AUDIT ===" && npm audit 2>&1 | tail -25
```

This installs dependencies (surfacing any deprecation/install warnings) and then runs `npm audit` to print the vulnerability summary. Audit also runs automatically in CI.

> ⚠️ A pull request can only be merged when `npm audit` reports **no CRITICAL or HIGH severity vulnerabilities**. If `npm audit` flags any, resolve them before requesting review — prefer adding an npm `overrides` block in `package.json` over running `npm audit fix --force`, which may apply breaking major downgrades.

### Run the extension locally

1. Open the repo folder in VS Code.
2. Press **F5** (or **Run → Start Debugging**) to launch the **Extension Development Host**.
3. In the new window, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run any `LiteLLM:` command.

---

## Testing

### Unit tests (no network, no VS Code)

```bash
npm run test:unit
```

These use a real local HTTP server to mock LiteLLM API responses. No external services are required.

### Full test suite (unit + integration)

```bash
# Integration tests auto-skip when LITELLM_API_BASE is unset
npm test

# Run integration tests against a live proxy
LITELLM_API_BASE=http://localhost:4000 \
LITELLM_API_KEY=sk-... \
npm run test:integration
```

### End-to-end tests

E2E tests download VS Code and run the extension inside it, verifying that commands are registered and the extension activates without errors.

```bash
npm run test:e2e

# On headless Linux (CI):
xvfb-run -a npm run test:e2e
```

### Writing new tests

- **Unit tests**: add a file matching `src/test/*.test.ts`. Use Node's built-in `http.createServer` for a mock server — no extra libraries needed.
- **Integration tests**: add files under `src/test/integration/`. Guard all tests with a `before()` hook that calls `ctx.skip()` when `LITELLM_API_BASE` is absent.
- **E2E tests**: add `describe`/`it` blocks to `src/test/e2e/suite/extension.test.ts`.

---

## Debugging in VS Code

The repo is pre-configured for extension debugging via F5. You can also attach the Node.js debugger to the test process:

```bash
# Start mocha with the inspector
node --inspect-brk node_modules/.bin/mocha "out/test/*.test.js"
```

Then attach via **Run → Attach to Node Process** in VS Code.

---

## Adding a new command

1. Implement the logic in a new `src/<feature>.ts` file.
2. Import and call it in `src/extension.ts` inside the `activate` function:

   ```typescript
   vscode.commands.registerCommand('litellm.myCommand', () => myFeature())
   ```

3. Add the command definition to `package.json` under `contributes.commands` and `contributes.menus.commandPalette`.
4. Write unit tests in `src/test/<feature>.unit.test.ts`.
5. Update `README.md` (Commands table + Feature guide section) and `CHANGELOG.md`.

---

## Submitting a pull request

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes and ensure all tests pass: `npm run lint && npm test`.
3. Add or update tests as appropriate.
4. Update `CHANGELOG.md` under the `[Unreleased]` heading.
5. Open a pull request — CI will run automatically.

Please keep pull requests focused on a single concern. For large changes, open an issue first to discuss the approach.
