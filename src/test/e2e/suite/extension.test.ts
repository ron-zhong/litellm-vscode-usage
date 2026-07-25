/**
 * E2E tests for the LiteLLM VS Code extension.
 *
 * These tests run inside a real VS Code instance launched by @vscode/test-electron.
 * They verify that the extension activates correctly and exposes all expected commands.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

/** Expected extension ID: publisher.name from package.json */
const EXTENSION_ID = 'litellm.litellm-usage';

/** All commands contributed by this extension. */
const EXPECTED_COMMANDS = [
  'litellm.showUsage',
  'litellm.showSpendDetails',
  'litellm.configureChatByok',
  'litellm.refresh',
  'litellm.generateCommitMessage',
  'litellm.configureModels',
];

describe('LiteLLM Extension — E2E', () => {
  let ext: vscode.Extension<unknown> | undefined;

  before(async () => {
    ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  it('is installed in this VS Code instance', () => {
    assert.ok(ext, `Extension "${EXTENSION_ID}" should be installed`);
  });

  it('activates without error', () => {
    assert.ok(ext?.isActive, 'Extension should be active after activation');
  });

  it('registers all expected commands', async () => {
    const allCommands = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(
        allCommands.includes(cmd),
        `Command "${cmd}" should be registered`
      );
    }
  });
});
