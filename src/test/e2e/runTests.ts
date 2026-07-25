/**
 * E2E test runner for the LiteLLM VS Code extension.
 *
 * Downloads/reuses VS Code and runs the test suite inside it.
 * On Linux CI: xvfb-run -a npm run test:e2e
 */
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // The root of the extension (where package.json lives)
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

  // The compiled suite index that VS Code will execute
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    // Disable all other marketplace extensions for a clean test environment.
    // Our extension is still loaded because of extensionDevelopmentPath.
    launchArgs: ['--disable-extensions'],
  });
}

main().catch((err: unknown) => {
  console.error('E2E test runner failed:', err);
  process.exit(1);
});
