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
