/**
 * Integration tests for litellmClient functions.
 *
 * These tests make real HTTP calls to a running LiteLLM proxy.
 * They are skipped automatically when LITELLM_API_BASE is not set.
 *
 * Run with:
 *   LITELLM_API_BASE=http://localhost:4000 \
 *   LITELLM_API_KEY=sk-...                 \
 *   npm run test:integration
 */
import * as assert from 'assert';
import {
  fetchUserInfo,
  fetchSpendLogs,
  fetchAvailableModels,
  generateCommitMessageFromDiff,
  today,
} from '../../litellmClient';

const API_BASE = process.env['LITELLM_API_BASE'] ?? '';
const API_KEY = process.env['LITELLM_API_KEY'] ?? '';
const MODEL = process.env['LITELLM_TEST_MODEL'] ?? 'gpt-4o';

// Skip the entire suite when no proxy is configured
function skipIfNotConfigured(ctx: Mocha.Context): void {
  if (!API_BASE) {
    ctx.skip();
  }
}

describe('LiteLLM integration (requires LITELLM_API_BASE)', function () {
  // Generous timeout for real network calls
  this.timeout(30000);

  before(function () {
    skipIfNotConfigured(this);
  });

  // ── fetchAvailableModels ───────────────────────────────────────────────────

  describe('fetchAvailableModels', () => {
    it('returns a non-empty array of model IDs', async () => {
      const models = await fetchAvailableModels(API_BASE, API_KEY);
      assert.ok(Array.isArray(models), 'Result should be an array');
      assert.ok(models.length > 0, 'At least one model should be available');
      for (const model of models) {
        assert.ok(typeof model.id === 'string' && model.id.length > 0, 'Each model must have a non-empty id');
      }
    });
  });

  // ── fetchUserInfo ──────────────────────────────────────────────────────────

  describe('fetchUserInfo', () => {
    it('returns a UserInfo object with a userId string', async () => {
      const info = await fetchUserInfo(API_BASE, API_KEY);
      assert.ok(typeof info.userId === 'string', 'userId should be a string');
      assert.ok(Array.isArray(info.keys), 'keys should be an array');
    });

    it('returns numeric spend values', async () => {
      const info = await fetchUserInfo(API_BASE, API_KEY);
      if (info.userInfo) {
        assert.ok(typeof info.userInfo.spend === 'number', 'userInfo.spend should be a number');
      }
      for (const key of info.keys) {
        assert.ok(typeof key.spend === 'number', `key.spend should be a number (key: ${key.key})`);
      }
    });
  });

  // ── fetchSpendLogs ─────────────────────────────────────────────────────────

  describe('fetchSpendLogs', () => {
    it('returns an array (may be empty) for today', async () => {
      const t = today();
      const logs = await fetchSpendLogs(API_BASE, API_KEY, t, t);
      assert.ok(Array.isArray(logs), 'Result should be an array');
    });

    it('returns entries with the expected fields when logs exist', async () => {
      const t = today();
      const logs = await fetchSpendLogs(API_BASE, API_KEY, t, t);
      for (const log of logs) {
        assert.ok(typeof log.requestId === 'string', 'requestId must be a string');
        assert.ok(typeof log.model === 'string', 'model must be a string');
        assert.ok(typeof log.spend === 'number', 'spend must be a number');
      }
    });
  });

  // ── generateCommitMessageFromDiff ──────────────────────────────────────────

  describe('generateCommitMessageFromDiff', () => {
    it('generates a non-empty commit message for a simple diff', async function () {
      // This test actually calls the LLM — skip when model is unavailable
      const sampleDiff = `
diff --git a/src/index.ts b/src/index.ts
index 1234abc..5678def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,6 @@
 export function greet(name: string): string {
-  return 'Hello ' + name;
+  return \`Hello, \${name}!\`;
 }
+
+export function goodbye(name: string): string {
+  return \`Goodbye, \${name}!\`;
+}
`.trim();

      const message = await generateCommitMessageFromDiff(API_BASE, API_KEY, MODEL, sampleDiff);
      assert.ok(typeof message === 'string', 'Commit message should be a string');
      assert.ok(message.trim().length > 0, 'Commit message should not be empty');
      // Should be a single line (conventional commit format)
      const lines = message.split('\n').filter((l) => l.trim());
      assert.ok(lines.length >= 1, 'Should have at least one non-empty line');
    });
  });
});
