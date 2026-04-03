/**
 * Tests for Layer 1 agirails_find_agents — AgentRegistry-backed discovery.
 * Run after build: node --test tests/
 *
 * All tests run offline (no live RPC). AgentRegistry is mocked via constructor
 * injection so the formatter and integration logic can be verified without
 * network calls or a private key.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUSDC,
  formatAgentCard,
  FIND_AGENTS_SCHEMA,
  findAgents,
  getAgentCard,
  getQuickstart,
} from '../dist/tools/layer1-discovery.js';

// ── formatUSDC ────────────────────────────────────────────────────────────────

describe('formatUSDC()', () => {
  test('formats 1 USDC correctly', () => {
    assert.equal(formatUSDC(1_000_000n), '$1.00');
  });

  test('formats 0 USDC', () => {
    assert.equal(formatUSDC(0n), '$0.00');
  });

  test('formats fractional amounts', () => {
    assert.equal(formatUSDC(500_000n), '$0.50');
  });

  test('formats large amounts', () => {
    assert.equal(formatUSDC(100_000_000n), '$100.00');
  });

  test('formats micro amounts', () => {
    assert.equal(formatUSDC(1n), '$0.00');
  });
});

// ── formatAgentCard ───────────────────────────────────────────────────────────

const MOCK_PROFILE = {
  agentAddress: '0xabc123',
  did: 'did:ethr:8453:0xabc123',
  endpoint: 'https://translator.example.com/webhook',
  reputationScore: 9500,
  totalTransactions: 42,
  isActive: true,
};

const MOCK_SERVICES = [
  {
    serviceType: 'translation',
    schemaURI: 'ipfs://QmSchemaHash',
    minPrice: 1_000_000n,   // $1.00
    maxPrice: 5_000_000n,   // $5.00
    avgCompletionTime: 30,
  },
];

describe('formatAgentCard()', () => {
  test('includes DID and address', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('did:ethr:8453:0xabc123'));
    assert.ok(card.includes('0xabc123'));
  });

  test('includes reputation and job count', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('95.00/100'));
    assert.ok(card.includes('42 jobs'));
  });

  test('includes active status', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('Active'));
  });

  test('includes inactive status when isActive=false', () => {
    const card = formatAgentCard({ ...MOCK_PROFILE, isActive: false }, [], 1);
    assert.ok(card.includes('Inactive'));
  });

  test('includes service type and price range', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('translation'));
    assert.ok(card.includes('$1.00'));
    assert.ok(card.includes('$5.00'));
  });

  test('includes SLA when avgCompletionTime > 0', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('SLA ~30s'));
  });

  test('omits SLA when avgCompletionTime is 0', () => {
    const noSlaService = { ...MOCK_SERVICES[0], avgCompletionTime: 0 };
    const card = formatAgentCard(MOCK_PROFILE, [noSlaService], 1);
    assert.ok(!card.includes('SLA'));
  });

  test('includes covenant schema URI', () => {
    const card = formatAgentCard(MOCK_PROFILE, MOCK_SERVICES, 1);
    assert.ok(card.includes('ipfs://QmSchemaHash'));
  });

  test('shows single price when min === max', () => {
    const fixedService = { ...MOCK_SERVICES[0], maxPrice: 1_000_000n };
    const card = formatAgentCard(MOCK_PROFILE, [fixedService], 1);
    assert.ok(card.includes('$1.00'));
    assert.ok(!card.includes('$1.00–$1.00'));
  });

  test('includes 1-based index in header', () => {
    const card1 = formatAgentCard(MOCK_PROFILE, [], 1);
    const card3 = formatAgentCard(MOCK_PROFILE, [], 3);
    assert.ok(card1.startsWith('**[1]'));
    assert.ok(card3.startsWith('**[3]'));
  });

  test('handles empty service list gracefully', () => {
    const card = formatAgentCard(MOCK_PROFILE, [], 1);
    assert.ok(card.includes('did:ethr:8453:0xabc123'));
    assert.ok(!card.includes('Services:'));
  });
});

// ── FIND_AGENTS_SCHEMA validation ─────────────────────────────────────────────

describe('FIND_AGENTS_SCHEMA', () => {
  test('accepts capability only', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ capability: 'translation' });
    assert.ok(result.success);
    assert.equal(result.data.capability, 'translation');
    assert.equal(result.data.network, 'base-mainnet');
  });

  test('accepts keyword only', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ keyword: 'data' });
    assert.ok(result.success);
    assert.equal(result.data.keyword, 'data');
  });

  test('defaults limit to 10', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.limit, 10);
  });

  test('defaults network to base-mainnet', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.network, 'base-mainnet');
  });

  test('accepts base-sepolia network', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ network: 'base-sepolia' });
    assert.ok(result.success);
    assert.equal(result.data.network, 'base-sepolia');
  });

  test('rejects unknown network', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ network: 'polygon' });
    assert.ok(!result.success);
  });

  test('rejects limit above 50', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ limit: 51 });
    assert.ok(!result.success);
  });

  test('rejects limit of 0', () => {
    const result = FIND_AGENTS_SCHEMA.safeParse({ limit: 0 });
    assert.ok(!result.success);
  });
});

// ── findAgents — AgentRegistry execution paths ────────────────────────────────

const MOCK_ADDR_1 = '0x0000000000000000000000000000000000000001';
const MOCK_ADDR_2 = '0x0000000000000000000000000000000000000002';

const MOCK_REGISTRY_PROFILE_1 = {
  agentAddress: MOCK_ADDR_1,
  did: 'did:ethr:8453:0x0001',
  endpoint: 'https://translator.example.com',
  reputationScore: 9500,
  totalTransactions: 42,
  isActive: true,
};

const MOCK_REGISTRY_SERVICES_1 = [
  {
    serviceType: 'translation',
    schemaURI: 'ipfs://QmHash',
    minPrice: 1_000_000n,
    maxPrice: 5_000_000n,
    avgCompletionTime: 30,
  },
];

/** Build a mock AgentRegistryLike that the registryFactory can return. */
function buildMockRegistry({
  addresses = [MOCK_ADDR_1],
  keywordAddresses = [MOCK_ADDR_1],
  profile = MOCK_REGISTRY_PROFILE_1,
  services = MOCK_REGISTRY_SERVICES_1,
  queryError = null,
} = {}) {
  return {
    computeServiceTypeHash: (serviceType) =>
      '0x' + Buffer.from(serviceType).toString('hex').padEnd(64, '0'),
    queryAgentsByService: async (_params) => {
      if (queryError) throw queryError;
      return addresses;
    },
    findAgentsByKeyword: async (_keyword, _limit) => keywordAddresses,
    getAgent: async (addr) => (addr === MOCK_ADDR_1 ? profile : null),
    getServiceDescriptors: async (addr) => (addr === MOCK_ADDR_1 ? services : []),
  };
}

describe('findAgents() — capability path (AgentRegistry-backed)', () => {
  test('returns formatted agent card for capability query', async () => {
    const registry = buildMockRegistry();
    const result = await findAgents(
      { capability: 'translation', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('AGIRAILS Agent Registry'), `header missing in: ${result}`);
    assert.ok(result.includes('did:ethr:8453:0x0001'), `DID missing in: ${result}`);
    assert.ok(result.includes('translation'), `service type missing in: ${result}`);
  });

  test('applies keyword filter when both capability and keyword are given', async () => {
    const registry = buildMockRegistry({
      addresses: [MOCK_ADDR_1, MOCK_ADDR_2],
      profile: MOCK_REGISTRY_PROFILE_1,
      services: MOCK_REGISTRY_SERVICES_1,
    });
    // ADDR_2 resolves to null profile so only ADDR_1 card is produced;
    // keyword 'translator' matches the endpoint in the card
    const result = await findAgents(
      { capability: 'translation', keyword: 'translator', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('translator.example.com'), `keyword match missing in: ${result}`);
  });

  test('returns no-match message when keyword filters out all results', async () => {
    const registry = buildMockRegistry();
    const result = await findAgents(
      { capability: 'translation', keyword: 'zzznomatch', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents matched'), `expected no-match message in: ${result}`);
  });

  test('returns no-agents message when registry returns empty list', async () => {
    const registry = buildMockRegistry({ addresses: [] });
    const result = await findAgents(
      { capability: 'translation', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents found'), `expected no-agents message in: ${result}`);
  });

  test('falls through to empty when QueryCapExceededError is thrown', async () => {
    const capError = new Error('Too many agents');
    capError.constructor = { name: 'QueryCapExceededError' };
    Object.defineProperty(capError, 'constructor', { value: { name: 'QueryCapExceededError' } });
    // Simulate the SDK error by name
    class QueryCapExceededError extends Error {
      constructor() { super('Too many agents'); this.name = 'QueryCapExceededError'; }
    }
    const registry = buildMockRegistry({ queryError: new QueryCapExceededError() });
    const result = await findAgents(
      { capability: 'translation', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('No agents found'), `expected fallback message in: ${result}`);
  });

  test('rethrows non-QueryCapExceededError from queryAgentsByService', async () => {
    const registry = buildMockRegistry({ queryError: new Error('RPC connection failed') });
    await assert.rejects(
      () => findAgents({ capability: 'translation', limit: 10, network: 'base-mainnet' }, () => registry),
      /RPC connection failed/,
    );
  });

  test('returns could-not-load-profiles message when all getAgent calls return null', async () => {
    const registry = buildMockRegistry({ profile: null });
    const result = await findAgents(
      { capability: 'translation', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.ok(result.includes('could not load profiles'), `expected profile-load error in: ${result}`);
  });

  test('returns registry-connect error when registryFactory throws', async () => {
    const result = await findAgents(
      { capability: 'translation', limit: 10, network: 'base-mainnet' },
      () => { throw new Error('no RPC endpoint'); },
    );
    assert.ok(result.includes('Could not connect'), `expected connect-error in: ${result}`);
  });
});

describe('findAgents() — keyword-only path (discover API)', () => {
  // Helper: stub globalThis.fetch for keyword path tests
  function withFetchStub(response, fn) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
    return fn().finally(() => { globalThis.fetch = originalFetch; });
  }

  function mockDiscoverResponse(agents) {
    return { ok: true, status: 200, json: async () => ({ agents, total: agents.length }) };
  }

  function mockAgent(overrides = {}) {
    return {
      slug: 'translator-agent',
      wallet_address: MOCK_ADDR_1,
      published_config: { name: 'Translator', description: 'Translates text', capabilities: ['translation'], pricing: { amount: '5', currency: 'USDC', unit: 'job' }, payment_mode: 'actp' },
      stats: { reputation_score: 9500, completed_transactions: 42 },
      ...overrides,
    };
  }

  test('returns agent cards from discover API', async () => {
    await withFetchStub(mockDiscoverResponse([mockAgent()]), async () => {
      const result = await findAgents({ keyword: 'translator', limit: 10, network: 'base-mainnet' });
      assert.ok(result.includes('Translator'), `expected agent name in: ${result}`);
      assert.ok(result.includes('translator-agent'), `expected slug in: ${result}`);
      assert.ok(result.includes(MOCK_ADDR_1), `expected address in: ${result}`);
    });
  });

  test('returns no-agents message when discover returns empty list', async () => {
    await withFetchStub(mockDiscoverResponse([]), async () => {
      const result = await findAgents({ keyword: 'nonexistent', limit: 10, network: 'base-mainnet' });
      assert.ok(result.includes('No agents found for keyword'), `expected no-agents message in: ${result}`);
      assert.ok(result.includes('nonexistent'), `should mention keyword in: ${result}`);
    });
  });

  test('returns backend-unavailable on HTTP error', async () => {
    await withFetchStub({ ok: false, status: 503 }, async () => {
      const result = await findAgents({ keyword: 'translator', limit: 10, network: 'base-mainnet' });
      assert.ok(result.includes('discover backend is currently unavailable'), `expected unavailable in: ${result}`);
      assert.ok(result.includes('503'), `expected status code in: ${result}`);
    });
  });

  test('returns backend-unavailable on network error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const result = await findAgents({ keyword: 'translator', limit: 10, network: 'base-mainnet' });
      assert.ok(result.includes('discover backend is currently unavailable'), `expected unavailable in: ${result}`);
      assert.ok(result.includes('ECONNREFUSED'), `expected error text in: ${result}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does NOT call queryAgentsByService in keyword-only mode', async () => {
    let queryCallCount = 0;
    const registry = buildMockRegistry();
    registry.queryAgentsByService = async () => { queryCallCount++; return []; };

    await withFetchStub(mockDiscoverResponse([mockAgent()]), async () => {
      await findAgents({ keyword: 'translator', limit: 10, network: 'base-mainnet' }, () => registry);
      assert.equal(queryCallCount, 0, 'queryAgentsByService must not be called in keyword-only mode');
    });
  });
});

// ── getAgentCard — URL pattern regression test ──────────────────────────────

describe('getAgentCard() — URL pattern', () => {
  test('requests /a/{slug}/{slug}.md, not /a/{slug}.md', async () => {
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      return { ok: true, status: 200, text: async () => '# Test Agent Card' };
    };
    try {
      await getAgentCard({ slug: 'azimuth' });
      assert.ok(capturedUrl.includes('/a/azimuth/azimuth.md'), `URL must use /a/{slug}/{slug}.md pattern, got: ${capturedUrl}`);
      assert.ok(!capturedUrl.endsWith('/a/azimuth.md'), `URL must NOT use /a/{slug}.md pattern, got: ${capturedUrl}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns card content with header', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '# My Agent\nDescription here' });
    try {
      const result = await getAgentCard({ slug: 'test-agent' });
      assert.ok(result.includes('Agent Card: test-agent'), `should include card header in: ${result}`);
      assert.ok(result.includes('# My Agent'), `should include card body in: ${result}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns not-found message for 404', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    try {
      const result = await getAgentCard({ slug: 'nonexistent' });
      assert.ok(result.includes('not found'), `should say not found in: ${result}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── getQuickstart — TypeScript pay snippet (Fix #19 regression guard) ─────────

describe('getQuickstart() — TypeScript pay snippet', () => {
  test('uses service name as first arg, not agent slug', () => {
    const output = getQuickstart({ intent: 'pay', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("request('translation'"), `expected request('translation', ...) in: ${output}`);
  });

  test('uses input: key, not service:', () => {
    const output = getQuickstart({ intent: 'pay', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes('input:'), `expected input: key in: ${output}`);
    assert.ok(!output.includes('service:'), `legacy service: key must not appear in: ${output}`);
  });

  test('budget is a number, not a string', () => {
    const output = getQuickstart({ intent: 'pay', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes('budget: 5'), `expected numeric budget: 5 in: ${output}`);
    assert.ok(!output.includes("budget: '"), `budget must not be a string in: ${output}`);
  });

  test('does not contain legacy request("agent-slug") pattern', () => {
    const output = getQuickstart({ intent: 'pay', language: 'typescript', network: 'testnet' });
    assert.ok(!output.includes("request('agent-slug'"), `legacy agent-slug must not appear in: ${output}`);
  });

  test('works for both intent (includes pay snippet)', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("request('translation'"), `expected request('translation', ...) in both-intent: ${output}`);
    assert.ok(output.includes('input:'), `expected input: in both-intent: ${output}`);
    assert.ok(output.includes('budget: 5'), `expected numeric budget in both-intent: ${output}`);
  });

  test('earn intent does not produce pay snippet', () => {
    const output = getQuickstart({ intent: 'earn', language: 'typescript', network: 'testnet' });
    assert.ok(!output.includes('budget: 5'), `earn-only snippet should not include pay budget in: ${output}`);
  });
});

// ── getQuickstart — full agent snippet SDK 3.0 request contract (AGI-29 rework) ──

describe('getQuickstart() — full agent snippet request contract', () => {
  test('full agent snippet uses SDK 3.0 Agent.request(service, { input, budget: number })', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("agent.request('analysis'"), `expected agent.request('analysis', ...) in full snippet: ${output}`);
    assert.ok(output.includes('input:'), `expected input: field in full snippet: ${output}`);
    assert.ok(!output.includes("budget: '10'"), `string budget '10' must not appear in full snippet: ${output}`);
    assert.ok(!output.includes("request('other-agent-slug'"), `legacy other-agent-slug must not appear in full snippet: ${output}`);
  });

  test('full agent snippet uses SDK 3.0 return shape: { result, transaction }', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes('{ result, transaction }'), `expected SDK 3.0 destructure { result, transaction } in full snippet: ${output}`);
    assert.ok(output.includes('transaction.id'), `expected transaction.id in full snippet: ${output}`);
    assert.ok(!output.includes('{ result, txId }'), `legacy { result, txId } must not appear in full snippet: ${output}`);
  });

  test('full agent snippet provide() uses job.input (not job.service) as work data', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    // The full snippet's provide() callback must use job.input for work data
    assert.ok(output.includes('job.input'), `expected job.input in provide() callback in full snippet: ${output}`);
    // Template-literal usage of job.service (e.g. `${job.service}`) must not appear — comments are acceptable
    assert.ok(!output.includes('${job.service}'), `template-literal job.service must not appear in provide() callback: ${output}`);
  });
});

// ── getQuickstart — SDK 3.0 event names (Fix #21 / AGI-50 regression guard) ──

describe('getQuickstart() — SDK 3.0 event names', () => {
  test('full agent snippet uses job:received, job:completed, payment:received', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("'job:received'"), `expected job:received in: ${output}`);
    assert.ok(output.includes("'job:completed'"), `expected job:completed in: ${output}`);
    assert.ok(output.includes("'payment:received'"), `expected payment:received in: ${output}`);
  });

  test('full agent snippet does not contain legacy transaction:* event names', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(!output.includes('transaction:quoted'), `legacy transaction:quoted must not appear in: ${output}`);
    assert.ok(!output.includes('transaction:committed'), `legacy transaction:committed must not appear in: ${output}`);
    assert.ok(!output.includes('transaction:settled'), `legacy transaction:settled must not appear in: ${output}`);
  });
});

// ── getQuickstart — provide() snippet accuracy (Fix #18 / AGI-47 regression guard) ──

describe('getQuickstart() — provide() earn snippet', () => {
  test('earn snippet uses job.input (not job.service) as work data', () => {
    const output = getQuickstart({ intent: 'earn', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes('job.input'), `expected job.input in earn snippet: ${output}`);
  });

  test('earn snippet does not use legacy job.amountMicro comment', () => {
    const output = getQuickstart({ intent: 'earn', language: 'typescript', network: 'testnet' });
    assert.ok(!output.includes('amountMicro'), `legacy amountMicro must not appear in earn snippet: ${output}`);
  });

  test('earn snippet documents job.budget for payment amount', () => {
    const output = getQuickstart({ intent: 'earn', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes('job.budget'), `expected job.budget in earn snippet: ${output}`);
  });

  test('earn snippet uses correct provide() signature: (name, handler, options)', () => {
    const output = getQuickstart({ intent: 'earn', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("provide('your-service-name'"), `expected provide('your-service-name', ...) in: ${output}`);
    assert.ok(output.includes("{ network:"), `expected options object with network key in: ${output}`);
  });

  test('both intent includes provide() earn snippet', () => {
    const output = getQuickstart({ intent: 'both', language: 'typescript', network: 'testnet' });
    assert.ok(output.includes("provide('your-service-name'"), `expected provide() in both-intent: ${output}`);
    assert.ok(output.includes('job.input'), `expected job.input in both-intent earn snippet: ${output}`);
  });
});

// ── getQuickstart — Python pay snippet SDK 3.0 alignment ────────────────────

describe('getQuickstart() — Python pay snippet', () => {
  test('uses service name as first arg, not agent slug', () => {
    const output = getQuickstart({ intent: 'pay', language: 'python', network: 'testnet' });
    assert.ok(output.includes("request('translation'"), `expected request('translation', ...) in: ${output}`);
    assert.ok(!output.includes("request('agent-slug'"), `legacy agent-slug must not appear in: ${output}`);
  });

  test('uses input key, not service key', () => {
    const output = getQuickstart({ intent: 'pay', language: 'python', network: 'testnet' });
    assert.ok(output.includes("'input':"), `expected 'input' key in: ${output}`);
    assert.ok(!output.includes("'service':"), `legacy 'service' key must not appear in: ${output}`);
  });

  test('budget is a number, not a string', () => {
    const output = getQuickstart({ intent: 'pay', language: 'python', network: 'testnet' });
    assert.ok(output.includes("'budget': 5"), `expected numeric budget in: ${output}`);
    assert.ok(!output.includes("'budget': '5'"), `budget must not be a string in: ${output}`);
  });
});

describe('getQuickstart() — Python earn snippet', () => {
  test('uses job.input as work data, not job.service', () => {
    const output = getQuickstart({ intent: 'earn', language: 'python', network: 'testnet' });
    assert.ok(output.includes('job.input'), `expected job.input in: ${output}`);
  });

  test('documents job.budget for payment amount', () => {
    const output = getQuickstart({ intent: 'earn', language: 'python', network: 'testnet' });
    assert.ok(output.includes('job.budget'), `expected job.budget in: ${output}`);
  });
});

describe('findAgents() — no search term', () => {
  test('returns prompt when neither capability nor keyword is given', async () => {
    const result = await findAgents({ limit: 10, network: 'base-mainnet' });
    assert.ok(
      result.includes('capability') && result.includes('keyword'),
      `expected guidance message in: ${result}`,
    );
  });
});
