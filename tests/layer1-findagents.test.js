/**
 * Behavioral tests for findAgents — capability (on-chain) and keyword (discover API).
 * All tests run offline: AgentRegistry is injected as a mock, fetch is stubbed.
 * Run after build: node --test tests/
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { findAgents } from '../dist/tools/layer1-discovery.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeProfile(addr = '0xabc123') {
  return {
    agentAddress: addr,
    did: `did:ethr:8453:${addr}`,
    endpoint: `https://agent-${addr.slice(2, 8)}.example.com`,
    reputationScore: 9500,
    totalTransactions: 42,
    isActive: true,
  };
}

function makeRegistry({ addresses = [], profiles = null, services = [], queryError = null } = {}) {
  return {
    computeServiceTypeHash(s) {
      return '0x' + Buffer.from(s).toString('hex').slice(0, 8);
    },
    async queryAgentsByService(_params) {
      if (queryError) throw queryError;
      return addresses;
    },
    async getAgent(addr) {
      if (profiles) return profiles[addr] ?? null;
      return makeProfile(addr);
    },
    async getServiceDescriptors(_addr) {
      return services;
    },
  };
}

/** Build a mock discover API response */
function makeDiscoverResponse(agents = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ agents, total: agents.length }),
  };
}

function makeDiscoverAgent(overrides = {}) {
  return {
    slug: 'test-agent',
    wallet_address: '0xabc123',
    published_config: {
      name: 'Test Agent',
      description: 'A test agent for unit tests',
      capabilities: ['translation'],
      pricing: { amount: '5', currency: 'USDC', unit: 'job' },
      payment_mode: 'actp',
    },
    stats: { reputation_score: 0, completed_transactions: 0 },
    card_url: 'https://www.agirails.app/a/test-agent/test-agent.md',
    profile_url: 'https://www.agirails.app/a/test-agent',
    ...overrides,
  };
}

// ── Capability path ───────────────────────────────────────────────────────────

describe('findAgents() — capability path', () => {
  test('returns formatted agent card when address found', async () => {
    const registry = makeRegistry({ addresses: ['0xabc123'] });
    const result = await findAgents(
      { capability: 'translation', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('0xabc123'), 'card should include agent address');
    assert.ok(result.includes('AGIRAILS Agent Registry'), 'should have header');
  });

  test('returns no-agents message when registry returns empty list', async () => {
    const registry = makeRegistry({ addresses: [] });
    const result = await findAgents(
      { capability: 'translation', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents found for capability'), 'should say no agents found');
    assert.ok(result.includes('translation'), 'should mention capability');
  });

  test('returns connect-error message when registry factory throws', async () => {
    const result = await findAgents(
      { capability: 'translation', limit: 5, network: 'base-mainnet' },
      () => { throw new Error('not deployed on this network'); },
    );
    assert.ok(result.includes('Could not connect'), 'should mention connection error');
    assert.ok(result.includes('not deployed on this network'), 'should include error text');
  });

  test('falls through to empty when QueryCapExceededError is thrown', async () => {
    class QueryCapExceededError extends Error {}
    const registry = makeRegistry({ queryError: new QueryCapExceededError('cap exceeded') });
    const result = await findAgents(
      { capability: 'translation', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents found'), 'QueryCapExceededError should fall through to empty');
  });

  test('rethrows unexpected registry errors', async () => {
    const registry = makeRegistry({ queryError: new Error('unexpected RPC failure') });
    await assert.rejects(
      () => findAgents({ capability: 'translation', limit: 5, network: 'base-mainnet' }, () => registry),
      /unexpected RPC failure/,
    );
  });

  test('filters cards by keyword when both capability and keyword are given', async () => {
    const reg = makeRegistry({ addresses: ['0xaaa', '0xbbb'] });
    reg.getAgent = async (addr) => ({
      ...makeProfile(addr),
      endpoint: addr === '0xaaa' ? 'https://french-translate.io' : 'https://unrelated.io',
    });
    const result = await findAgents(
      { capability: 'translation', keyword: 'french', limit: 10, network: 'base-mainnet' },
      () => reg,
    );
    assert.ok(result.includes('french-translate.io'), 'matching profile should appear');
    assert.ok(!result.includes('unrelated.io'), 'non-matching profile should be filtered out');
  });

  test('returns no-keyword-match message when keyword filters out all results', async () => {
    const registry = makeRegistry({ addresses: ['0xabc'] });
    const result = await findAgents(
      { capability: 'translation', keyword: 'zzzunmatchable', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents matched keyword'), 'should say no keyword match');
    assert.ok(result.includes('zzzunmatchable'), 'should mention the keyword');
  });

  test('returns profiles-unavailable message when getAgent returns null for all', async () => {
    const reg = makeRegistry({ addresses: ['0xabc'] });
    reg.getAgent = async () => null;
    const result = await findAgents(
      { capability: 'translation', limit: 5, network: 'base-mainnet' },
      () => reg,
    );
    assert.ok(result.includes('could not load profiles'), 'should mention profile load failure');
  });
});

// ── Keyword-only path ─────────────────────────────────────────────────────────
// Keyword-only discovery calls the discover API directly (fetch) and formats
// the response. It does NOT use AgentRegistry for enrichment.

describe('findAgents() — keyword-only path', () => {
  test('returns agent cards from discover API response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeDiscoverResponse([makeDiscoverAgent()]);
    try {
      const result = await findAgents(
        { keyword: 'test', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('Test Agent'), 'should include agent name');
      assert.ok(result.includes('test-agent'), 'should include slug');
      assert.ok(result.includes('0xabc123'), 'should include wallet address');
      assert.ok(result.includes('AGIRAILS Agents'), 'should have header');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns no-agents message when discover API returns empty list', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeDiscoverResponse([]);
    try {
      const result = await findAgents(
        { keyword: 'nonexistent', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('No agents found'), 'should say no agents found');
      assert.ok(result.includes('nonexistent'), 'should mention keyword');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns backend-unavailable message when discover API returns HTTP 500', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    try {
      const result = await findAgents(
        { keyword: 'translator', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('discover backend is currently unavailable'), 'should report backend unavailable');
      assert.ok(result.includes('500'), 'should include HTTP status');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns backend-unavailable message on network error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const result = await findAgents(
        { keyword: 'translator', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('discover backend is currently unavailable'), 'should report backend unavailable');
      assert.ok(result.includes('ECONNREFUSED'), 'should include error message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('includes capabilities and pricing in output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeDiscoverResponse([makeDiscoverAgent({
      published_config: {
        name: 'Price Agent',
        description: 'Has pricing',
        capabilities: ['data-analysis', 'reporting'],
        pricing: { amount: '10', currency: 'USDC', unit: 'job' },
        payment_mode: 'actp',
      },
    })]);
    try {
      const result = await findAgents(
        { keyword: 'data', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('data-analysis'), 'should include capabilities');
      assert.ok(result.includes('$10'), 'should include price');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('truncates long descriptions', async () => {
    const longDesc = 'A'.repeat(300);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeDiscoverResponse([makeDiscoverAgent({
      published_config: { name: 'Long', description: longDesc, capabilities: [] },
    })]);
    try {
      const result = await findAgents(
        { keyword: 'long', limit: 5, network: 'base-mainnet' },
        () => makeRegistry(),
      );
      assert.ok(result.includes('…'), 'should truncate with ellipsis');
      assert.ok(!result.includes('A'.repeat(300)), 'should not include full 300-char description');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not use AgentRegistry for keyword path (no queryAgentsByService call)', async () => {
    let queryCallCount = 0;
    const registry = makeRegistry();
    registry.queryAgentsByService = async () => { queryCallCount++; return []; };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeDiscoverResponse([makeDiscoverAgent()]);
    try {
      await findAgents({ keyword: 'test', limit: 5, network: 'base-mainnet' }, () => registry);
      assert.equal(queryCallCount, 0, 'queryAgentsByService must not be called in keyword-only mode');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── No params path ────────────────────────────────────────────────────────────

describe('findAgents() — no capability, no keyword', () => {
  test('returns helpful prompt when neither capability nor keyword provided', async () => {
    const result = await findAgents({ limit: 5, network: 'base-mainnet' });
    assert.ok(result.includes('capability') || result.includes('keyword'), 'should mention capability or keyword');
    assert.ok(result.includes('agirails.app'), 'should include browse link');
  });
});
