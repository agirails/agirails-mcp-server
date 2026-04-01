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

describe('findAgents() — keyword-only path (AgentRegistry-backed)', () => {
  test('routes keyword-only query through AgentRegistry using keyword as service type', async () => {
    let capturedServiceType = '';
    const registry = buildMockRegistry();
    const origHash = registry.computeServiceTypeHash.bind(registry);
    registry.computeServiceTypeHash = (s) => { capturedServiceType = s; return origHash(s); };

    const result = await findAgents(
      { keyword: 'translation', limit: 10, network: 'base-mainnet' },
      () => registry,
    );
    assert.equal(capturedServiceType, 'translation', 'keyword should be passed as service type');
    assert.ok(result.includes('AGIRAILS Agent Registry'), `expected registry header in: ${result}`);
    assert.ok(result.includes('translation'), `header should mention keyword in: ${result}`);
  });

  test('returns no-agents message when registry returns empty list for keyword', async () => {
    const registry = buildMockRegistry({ addresses: [] });
    const result = await findAgents({ keyword: 'nonexistent', limit: 10, network: 'base-mainnet' }, () => registry);
    assert.ok(result.includes('No agents found for keyword'), `expected no-agents message in: ${result}`);
    assert.ok(result.includes('nonexistent'), `should mention keyword in: ${result}`);
  });

  test('returns connect-error message when registry factory throws for keyword path', async () => {
    const result = await findAgents(
      { keyword: 'translation', limit: 10, network: 'base-mainnet' },
      () => { throw new Error('not deployed on this network'); },
    );
    assert.ok(result.includes('Could not connect'), `expected connect-error in: ${result}`);
    assert.ok(result.includes('not deployed on this network'), `should include error text in: ${result}`);
  });

  test('preserves network selection in keyword-only path', async () => {
    let capturedNetwork = '';
    const result = await findAgents(
      { keyword: 'translation', limit: 5, network: 'base-sepolia' },
      (networkName) => { capturedNetwork = networkName; return buildMockRegistry({ addresses: [] }); },
    );
    assert.equal(capturedNetwork, 'base-sepolia', 'should pass network to registry factory');
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
