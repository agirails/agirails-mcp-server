/**
 * Behavioral tests for findAgents — AgentRegistry and keyword-only discovery.
 * All tests run offline: AgentRegistry is injected as a mock, fetch is patched.
 * Run after build: node --test tests/
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
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

function mockFetchOk(agents, total = agents.length) {
  return async (_url, _opts) => ({
    ok: true,
    json: async () => ({ agents, total }),
  });
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
    // Distinguish the two profiles by endpoint
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

describe('findAgents() — keyword-only path', () => {
  let savedFetch;

  beforeEach(() => { savedFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = savedFetch; });

  test('calls discover API with keyword and returns formatted cards', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url, _opts) => {
      capturedUrl = url;
      return mockFetchOk([{
        slug: 'my-translator',
        published_config: {
          name: 'My Translator',
          capabilities: ['translation'],
          pricing: { amount: 2.50, currency: 'USDC' },
          payment_mode: 'actp',
        },
      }])();
    };

    const result = await findAgents({ keyword: 'translator', limit: 5 });

    assert.ok(capturedUrl.includes('/api/v1/discover'), 'should call discover endpoint');
    assert.ok(capturedUrl.includes('search=translator'), 'should pass keyword as search param');
    assert.ok(result.includes('My Translator'), 'card should include agent name');
    assert.ok(result.includes('my-translator'), 'card should include slug');
    assert.ok(result.includes('AGIRAILS Agent Discovery'), 'should have discovery header');
  });

  test('returns no-agents message when discover API returns empty list', async () => {
    globalThis.fetch = mockFetchOk([]);
    const result = await findAgents({ keyword: 'nonexistent', limit: 5 });
    assert.ok(result.includes('No agents found'), 'should say no agents found');
    assert.ok(result.includes('nonexistent'), 'should mention the keyword');
  });

  test('returns HTTP-error message when discover API returns non-ok status', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    const result = await findAgents({ keyword: 'translator', limit: 5 });
    assert.ok(result.includes('503'), 'should mention the HTTP status');
  });

  test('returns network-error message when fetch throws', async () => {
    globalThis.fetch = async () => { throw new Error('network timeout'); };
    const result = await findAgents({ keyword: 'translator', limit: 5 });
    assert.ok(
      result.includes('Could not reach') || result.includes('network timeout'),
      'should mention the fetch error',
    );
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
