/**
 * Mocha suite loader executed inside the VS Code extension host during E2E tests.
 * Registers all test files and returns a promise that resolves when the suite completes.
 */
import * as path from 'path';

// mocha is available in the extension host because it is a devDependency
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Mocha = require('mocha') as typeof import('mocha');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 15000,
  });

  mocha.addFile(path.resolve(__dirname, 'extension.test.js'));

  return new Promise((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} E2E test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
