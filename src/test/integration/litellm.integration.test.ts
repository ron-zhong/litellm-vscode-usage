/**
 * Integration tests for fetchBudgetInfo against a live LiteLLM proxy.
 *
 * These make a real HTTP GET /v2/user/info. They are skipped automatically
 * when LITELLM_API_BASE is not set.
 *
 * Run with:
 *   LITELLM_API_BASE=http://localhost:4000 \
 *   LITELLM_API_KEY=sk-...                 \
 *   npm run test:integration
 */
import * as assert from 'assert';
import { fetchBudgetInfo } from '../../litellmClient';

const API_BASE = process.env['LITELLM_API_BASE'] ?? '';
const API_KEY = process.env['LITELLM_API_KEY'] ?? '';

// Skip the entire suite when no proxy is configured
function skipIfNotConfigured(ctx: Mocha.Context): void {
  if (!API_BASE) {
    ctx.skip();
  }
}

describe('LiteLLM integration (requires LITELLM_API_BASE)', function () {
  // Generous timeout for real network calls (incl. retry backoff)
  this.timeout(30000);

  before(function () {
    skipIfNotConfigured(this);
  });

  // ── fetchBudgetInfo ───────────────────────────────────────────────────────

  describe('fetchBudgetInfo', () => {
    it('returns a BudgetInfo with numeric spend and the v2 source label', async () => {
      const info = await fetchBudgetInfo(API_BASE, API_KEY);
      assert.ok(typeof info.spend === 'number', 'spend should be a number');
      assert.strictEqual(info.source, '/v2/user/info');
    });

    it('returns null or number for maxBudget and optional budget fields', async () => {
      const info = await fetchBudgetInfo(API_BASE, API_KEY);
      assert.ok(
        info.maxBudget === null || typeof info.maxBudget === 'number',
        'maxBudget should be null or a number'
      );
      assert.ok(
        info.budgetDuration === null || typeof info.budgetDuration === 'string'
      );
      assert.ok(
        info.budgetResetAt === null || typeof info.budgetResetAt === 'string'
      );
    });
  });
});
