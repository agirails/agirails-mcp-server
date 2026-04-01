/**
 * Behavioral tests for findAgents — AgentRegistry-based discovery (capability and keyword).
 * All tests run offline: AgentRegistry is injected as a mock.
 * Run after build: node --test tests/
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findAgents, DiscoverBackendError } from '../dist/tools/layer1-discovery.js';

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

function makeRegistry({ addresses = [], keywordAddresses = addresses, profiles = null, services = [], queryError = null } = {}) {
  return {
    computeServiceTypeHash(s) {
      return '0x' + Buffer.from(s).toString('hex').slice(0, 8);
    },
    async queryAgentsByService(_params) {
      if (queryError) throw queryError;
      return addresses;
    },
    async findAgentsByKeyword(_keyword, _limit) {
      return keywordAddresses;
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
// Keyword-only discovery uses findAgentsByKeyword (keyword-capable off-chain source)
// to obtain candidate addresses, then enriches them from AgentRegistry and applies
// a free-text filter. queryAgentsByService is NOT called — keyword-as-serviceType
// returns zero results for domain/endpoint terms even when matching agents exist.

describe('findAgents() — keyword-only path', () => {
  test('uses findAgentsByKeyword (not queryAgentsByService) to get candidates', async () => {
    let queryCallCount = 0;
    const registry = makeRegistry({ keywordAddresses: ['0xabc123'] });
    registry.queryAgentsByService = async (...args) => { queryCallCount++; return []; };
    // Set endpoint to contain the keyword so the free-text filter passes
    registry.getAgent = async (addr) => ({ ...makeProfile(addr), endpoint: 'https://translator.example.com' });

    const result = await findAgents(
      { keyword: 'translator', limit: 5, network: 'base-mainnet' },
      () => registry,
    );

    assert.equal(queryCallCount, 0, 'queryAgentsByService must not be called in keyword-only mode');
    assert.ok(result.includes('0xabc123'), 'card should include agent address');
    assert.ok(result.includes('AGIRAILS Agent Registry'), 'should have registry header');
  });

  test('realistic: registry returns [] for unknown hash; keyword-only succeeds via profile match', async () => {
    // Simulates realistic on-chain behavior: "translate-api" is not a registered service
    // type hash, so queryAgentsByService → []. But findAgentsByKeyword finds the address
    // via off-chain keyword search, and the agent's endpoint contains the keyword.
    const registry = makeRegistry({
      addresses: [],                    // queryAgentsByService always empty (unknown hash)
      keywordAddresses: ['0xabc123'],   // findAgentsByKeyword returns match
    });
    registry.getAgent = async (addr) => ({
      ...makeProfile(addr),
      endpoint: 'https://translate-api.example.io',
    });
    registry.getServiceDescriptors = async () => [
      { serviceType: 'data-processing', schemaURI: undefined, minPrice: 1000000n, maxPrice: 5000000n, avgCompletionTime: 30 },
    ];

    const result = await findAgents(
      { keyword: 'translate-api', limit: 5, network: 'base-mainnet' },
      () => registry,
    );

    assert.ok(result.includes('translate-api.example.io'), 'endpoint keyword match should appear');
    assert.ok(!result.includes('No agents found'), 'should not report no agents');
  });

  test('filters keyword candidates by free-text across profile fields', async () => {
    const reg = makeRegistry({ keywordAddresses: ['0xaaa', '0xbbb'] });
    reg.getAgent = async (addr) => ({
      ...makeProfile(addr),
      endpoint: addr === '0xaaa' ? 'https://translate-api.example.io' : 'https://unrelated.io',
    });
    reg.getServiceDescriptors = async () => [];

    const result = await findAgents(
      { keyword: 'translate-api', limit: 10, network: 'base-mainnet' },
      () => reg,
    );

    assert.ok(result.includes('translate-api.example.io'), 'matching endpoint should appear');
    assert.ok(!result.includes('unrelated.io'), 'non-matching endpoint should be filtered out');
  });

  test('returns no-match message when keyword not found in any profile field', async () => {
    const registry = makeRegistry({ keywordAddresses: ['0xabc123'] });
    const result = await findAgents(
      { keyword: 'zzz-unmatched', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents matched keyword'), 'should say no keyword match');
    assert.ok(result.includes('zzz-unmatched'), 'should mention the keyword');
  });

  test('returns no-agents message when findAgentsByKeyword returns empty list', async () => {
    const registry = makeRegistry({ keywordAddresses: [] });
    const result = await findAgents(
      { keyword: 'nonexistent', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents found'), 'should say no agents found');
    assert.ok(result.includes('nonexistent'), 'should mention the keyword');
  });

  test('returns connect-error message when registry factory throws for keyword path', async () => {
    const result = await findAgents(
      { keyword: 'translator', limit: 5, network: 'base-sepolia' },
      () => { throw new Error('not deployed on this network'); },
    );
    assert.ok(result.includes('Could not connect'), 'should mention connection error');
    assert.ok(result.includes('not deployed on this network'), 'should include error text');
  });

  test('preserves network selection in keyword-only path', async () => {
    let capturedNetwork = '';
    await findAgents(
      { keyword: 'translator', limit: 5, network: 'base-sepolia' },
      (networkName) => { capturedNetwork = networkName; return makeRegistry({ keywordAddresses: [] }); },
    );
    assert.equal(capturedNetwork, 'base-sepolia', 'should pass network to registry factory');
  });

  test('returns backend-unavailable message when discover API returns HTTP 500', async () => {
    const registry = makeRegistry();
    registry.findAgentsByKeyword = async () => {
      throw new DiscoverBackendError(500, 'discover API returned HTTP 500');
    };
    const result = await findAgents(
      { keyword: 'translator', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('discover backend is currently unavailable'), 'should report backend unavailable');
    assert.ok(result.includes('HTTP 500'), 'should include HTTP status');
    assert.ok(!result.includes('No agents found'), 'must not mislead with no-agents message');
  });

  test('returns backend-unavailable message when discover API returns HTTP 503', async () => {
    const registry = makeRegistry();
    registry.findAgentsByKeyword = async () => {
      throw new DiscoverBackendError(503, 'discover API returned HTTP 503');
    };
    const result = await findAgents(
      { keyword: 'escrow', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('discover backend is currently unavailable'), 'should report backend unavailable');
    assert.ok(result.includes('HTTP 503'), 'should include HTTP status');
    assert.ok(!result.includes('No agents found'), 'must not mislead with no-agents message');
  });

  test('returns backend-unavailable message on network error (status 0)', async () => {
    const registry = makeRegistry();
    registry.findAgentsByKeyword = async () => {
      throw new DiscoverBackendError(0, 'fetch failed');
    };
    const result = await findAgents(
      { keyword: 'translator', limit: 5, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('discover backend is currently unavailable'), 'should report backend unavailable');
    assert.ok(!result.includes('No agents found'), 'must not mislead with no-agents message');
  });

  test('rethrows non-DiscoverBackendError from findAgentsByKeyword', async () => {
    const registry = makeRegistry();
    registry.findAgentsByKeyword = async () => {
      throw new Error('unexpected internal error');
    };
    await assert.rejects(
      () => findAgents({ keyword: 'translator', limit: 5, network: 'base-mainnet' }, () => registry),
      /unexpected internal error/,
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
