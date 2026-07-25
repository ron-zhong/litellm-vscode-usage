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
  today,
} from '../../litellmClient';

const API_BASE = process.env['LITELLM_API_BASE'] ?? '';
const API_KEY = process.env['LITELLM_API_KEY'] ?? '';

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
});
