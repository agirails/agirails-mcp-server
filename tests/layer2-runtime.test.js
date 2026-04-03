/**
 * Tests for Layer 2 runtime: escaping safety, generator output, schema validation.
 * Run after build: node --test tests/
 *
 * Updated for SDK 3.0 (AGI-29): all generators now target SDK 3.0 API surface.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  shellQuote,
  generateInit,
  generateRequestService,
  generatePay,
  generateSubmitQuote,
  generateAcceptQuote,
  generateGetTransaction,
  generateListTransactions,
  generateDeliver,
  generateSettle,
  generateDispute,
  generateCancel,
  generateGetBalance,
  generateVerifyAgent,
  generatePublishConfig,
  INIT_SCHEMA,
  REQUEST_SERVICE_SCHEMA,
  PAY_SCHEMA,
  SUBMIT_QUOTE_SCHEMA,
  ACCEPT_QUOTE_SCHEMA,
  GET_TRANSACTION_SCHEMA,
  LIST_TRANSACTIONS_SCHEMA,
  DELIVER_SCHEMA,
  SETTLE_SCHEMA,
  DISPUTE_SCHEMA,
  CANCEL_SCHEMA,
  GET_BALANCE_SCHEMA,
  VERIFY_AGENT_SCHEMA,
  PUBLISH_CONFIG_SCHEMA,
} from '../dist/tools/layer2-runtime.js';

// ── esc() unit tests ──────────────────────────────────────────────────────────

describe('esc()', () => {
  test('leaves clean strings unchanged', () => {
    assert.equal(esc('hello'), 'hello');
    assert.equal(esc('5.00'), '5.00');
  });

  test('escapes single quotes', () => {
    assert.equal(esc("it's"), "it\\'s");
    assert.equal(esc("5'50"), "5\\'50");
  });

  test('escapes backslashes', () => {
    assert.equal(esc('a\\b'), 'a\\\\b');
  });

  test('escapes newlines', () => {
    assert.equal(esc('line1\nline2'), 'line1\\nline2');
    assert.equal(esc('line1\rline2'), 'line1\\rline2');
  });

  test('escapes combined injection payload', () => {
    const payload = "'; process.exit(1); //";
    const escaped = esc(payload);
    assert(!escaped.includes("';\n"), 'should not have unescaped quote+semicolon+newline');
    assert(escaped.startsWith("\\'"), 'first char should be escaped quote');
  });
});

// ── generateRequestService: SDK 3.0 contract ─────────────────────────────────

describe('generateRequestService', () => {
  const base = { service: 'analysis', input: 'Analyze this dataset', budget: 5, network: 'testnet' };

  test('budget is emitted as a numeric literal, not a string', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(base));
    assert(result.includes('budget: 5'), 'budget must appear as numeric literal');
    assert(!result.includes("budget: '5'"), 'budget must not be a quoted string');
  });

  test('uses SDK 3.0 return shape: { result, transaction }', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(base));
    assert(result.includes('{ result, transaction }'), 'must destructure result and transaction');
    assert(result.includes('transaction.id'), 'must reference transaction.id for the TX ID');
    assert(!result.includes('{ txId }'), 'legacy { txId } destructure must not appear');
  });

  test('first arg to agent.request() is service type, not agent slug', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(base));
    assert(result.includes("agent.request('analysis'"), 'first arg must be service type name');
  });

  test('options use input field (SDK 3.0), not service field', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(base));
    assert(result.includes("input: 'Analyze this dataset'"), 'options must include input field');
  });

  test('input with single quote is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, input: "don't fail" }));
    assert(!result.includes("input: 'don't fail'"), 'unescaped quote in input must not appear');
  });

  test('service with single quote is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, service: "it's-a-service" }));
    assert(!result.includes("request('it's-a-service'"), 'unescaped quote in service must not appear');
  });

  test('optional agentSlug includes AgentRegistry lookup in generated snippet', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, agentSlug: 'target-agent' }));
    assert(result.includes('AgentRegistry'), 'must include AgentRegistry import when agentSlug provided');
    assert(result.includes("getAgentBySlug('target-agent')"), 'must resolve slug to provider address');
  });

  test('agentSlug with special chars is escaped in generated snippet', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, agentSlug: "agent'x" }));
    assert(!result.includes("getAgentBySlug('agent'x'"), 'unescaped quote in slug must not appear');
  });

  // Fix #21 (AGI-50): SDK 3.0 uses payment:received, not transaction:* events
  test('uses payment:received event, not legacy transaction:* events', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(base));
    assert(result.includes("'payment:received'"), 'must include payment:received event');
    assert(!result.includes('transaction:quoted'), 'legacy transaction:quoted must not appear');
    assert(!result.includes('transaction:committed'), 'legacy transaction:committed must not appear');
    assert(!result.includes('transaction:settled'), 'legacy transaction:settled must not appear');
  });
});

// ── All generators return non-empty strings (SDK 3.0 API) ─────────────────────

describe('all generators produce output', () => {
  const txId = 'tx-abc-123';
  const network = 'testnet';

  // Fix #14 (AGI-43): init uses ACTPClient.create({ mode }) only; client.getAddress()
  test('generateInit uses getAddress() not agentAddress', () => {
    const r = generateInit(INIT_SCHEMA.parse({ name: 'my-agent', network }));
    assert(r.length > 50);
    assert(r.includes('ACTPClient'));
    assert(r.includes('getAddress()'), 'must use client.getAddress()');
    assert(!r.includes('agentAddress'), 'must not use removed agentAddress property');
    assert(!r.includes('agentId'), 'must not use removed agentId property');
    assert(!r.includes('agentName'), 'must not pass agentName to ACTPClient.create()');
    assert(!r.includes('overwrite'), 'must not pass overwrite to ACTPClient.create()');
  });

  // Fix #10 (AGI-39): x402 path uses X402Adapter + client.pay(), not client.x402.pay()
  test('generatePay x402 path uses X402Adapter', () => {
    const r = generatePay(PAY_SCHEMA.parse({ target: 'https://api.example.com/pay', amount: '1', network }));
    assert(r.includes('X402Adapter'), 'must use X402Adapter');
    assert(r.includes('client.pay('), 'must call client.pay()');
    assert(!r.includes('client.x402'), 'must not use non-existent client.x402 namespace');
  });

  // Fix #1 (AGI-30): ACTP path uses client.pay(), not client.kernel.pay()
  test('generatePay ACTP path uses client.pay()', () => {
    const r = generatePay(PAY_SCHEMA.parse({ target: '0xabc123', amount: '1', network }));
    assert(r.includes('client.pay('), 'must call client.pay()');
    assert(!r.includes('kernel.pay'), 'must not use non-existent kernel.pay');
  });

  // Fix #2 (AGI-31): submitQuote uses transitionState('QUOTED'), not kernel.submitQuote()
  test('generateSubmitQuote uses transitionState', () => {
    const r = generateSubmitQuote(SUBMIT_QUOTE_SCHEMA.parse({ txId, price: '3.00', deliverables: 'a report', network }));
    assert(r.includes('transitionState'), 'must use client.advanced.transitionState()');
    assert(r.includes("'QUOTED'"), 'must transition to QUOTED state');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #3 (AGI-32): acceptQuote uses standard.acceptQuote() + linkEscrow(); requires quotedPrice
  test('generateAcceptQuote uses standard.acceptQuote() and linkEscrow()', () => {
    const r = generateAcceptQuote(ACCEPT_QUOTE_SCHEMA.parse({ txId, quotedPrice: '3.00', network }));
    assert(r.includes('standard.acceptQuote'), 'must use client.standard.acceptQuote()');
    assert(r.includes('linkEscrow'), 'must call linkEscrow() to commit funds');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #4 (AGI-33): getTransaction uses advanced.getTransaction(), not kernel.getTransaction()
  test('generateGetTransaction uses advanced.getTransaction()', () => {
    const r = generateGetTransaction(GET_TRANSACTION_SCHEMA.parse({ txId, network }));
    assert(r.includes('advanced.getTransaction'), 'must use client.advanced.getTransaction()');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #5 (AGI-34): listTransactions uses advanced.getAllTransactions(), not kernel.listTransactions()
  test('generateListTransactions uses advanced.getAllTransactions()', () => {
    const r = generateListTransactions(LIST_TRANSACTIONS_SCHEMA.parse({ network }));
    assert(r.includes('getAllTransactions'), 'must use client.advanced.getAllTransactions()');
    assert(!r.includes('listTransactions'), 'must not use non-existent listTransactions');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #5 regression (AGI-29): role filter must produce executable code, not just a comment
  test('generateListTransactions role=requester produces executable filter code', () => {
    const r = generateListTransactions(LIST_TRANSACTIONS_SCHEMA.parse({ network, role: 'requester' }));
    assert(r.includes('client.getAddress()'), 'must call client.getAddress() to resolve own address');
    assert(r.includes('.requester === myAddress'), 'must filter by tx.requester field');
    assert(!r.includes('// Note:'), 'must not leave role filter as a comment');
  });

  test('generateListTransactions role=provider produces executable filter code', () => {
    const r = generateListTransactions(LIST_TRANSACTIONS_SCHEMA.parse({ network, role: 'provider' }));
    assert(r.includes('client.getAddress()'), 'must call client.getAddress() to resolve own address');
    assert(r.includes('.provider === myAddress'), 'must filter by tx.provider field');
    assert(!r.includes('// Note:'), 'must not leave role filter as a comment');
  });

  // Fix #6 (AGI-35): deliver uses client.deliver(), not kernel.deliver()
  test('generateDeliver uses client.deliver()', () => {
    const r = generateDeliver(DELIVER_SCHEMA.parse({ txId, deliverable: 'the file', network }));
    assert(r.includes('client.deliver('), 'must use client.deliver()');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #7 (AGI-36): settle uses client.release(), not kernel.settle()
  test('generateSettle uses client.release()', () => {
    const r = generateSettle(SETTLE_SCHEMA.parse({ txId, network }));
    assert(r.includes('client.release('), 'must use client.release()');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #8 (AGI-37): dispute uses transitionState('DISPUTED'), not kernel.dispute()
  test('generateDispute uses transitionState DISPUTED', () => {
    const r = generateDispute(DISPUTE_SCHEMA.parse({ txId, reason: 'wrong output', network }));
    assert(r.includes('transitionState'), 'must use client.advanced.transitionState()');
    assert(r.includes("'DISPUTED'"), 'must transition to DISPUTED state');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #9 (AGI-38): cancel uses transitionState('CANCELLED'), not kernel.cancel()
  test('generateCancel uses transitionState CANCELLED', () => {
    const r = generateCancel(CANCEL_SCHEMA.parse({ txId, network }));
    assert(r.includes('transitionState'), 'must use client.advanced.transitionState()');
    assert(r.includes("'CANCELLED'"), 'must transition to CANCELLED state');
    assert(!r.includes('kernel'), 'must not use non-existent kernel namespace');
  });

  // Fix #13 (AGI-42): getBalance requires address arg, returns string (not { usdc, locked, available })
  test('generateGetBalance passes address arg and no destructuring', () => {
    const r = generateGetBalance(GET_BALANCE_SCHEMA.parse({ network }));
    assert(r.includes('getBalance'), 'must call getBalance');
    assert(r.includes('getAddress()'), 'must pass client.getAddress() as address arg');
    assert(!r.includes('balance.usdc'), 'must not destructure removed .usdc property');
    assert(!r.includes('balance.locked'), 'must not destructure removed .locked property');
    assert(r.includes('balanceWei'), 'must log raw returned string value');
  });

  // Fix #11 (AGI-40): verifyAgent uses standalone AgentRegistry, not client.registry.verify()
  test('generateVerifyAgent uses standalone AgentRegistry', () => {
    const r = generateVerifyAgent(VERIFY_AGENT_SCHEMA.parse({ agentSlug: 'my-agent', network }));
    assert(r.includes('AgentRegistry'), 'must import and use AgentRegistry');
    assert(r.includes('registry.getAgent'), 'must call registry.getAgent()');
    assert(!r.includes('client.registry'), 'must not use non-existent client.registry namespace');
    assert(!r.includes('provider as any'), 'must not cast provider to any — AgentRegistry requires a Signer');
    assert(r.includes('Wallet.createRandom') || r.includes('signer'), 'must use a Signer for AgentRegistry');
  });

  // Fix #12 (AGI-41): publishConfig uses CLI command, not client.registry.publishConfig()
  test('generatePublishConfig uses agirails publish CLI', () => {
    const r = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse({ network }));
    assert(r.includes('agirails publish'), 'must reference agirails publish CLI');
    assert(!r.includes('client.registry'), 'must not use non-existent client.registry namespace');
    assert(!r.includes('registry.publishConfig'), 'must not call non-existent registry.publishConfig()');
  });

  // Fix #12 / AGI-53: configPath must be shell-quoted in the generated bash command
  test('generatePublishConfig shell-quotes configPath with spaces', () => {
    const r = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse({ configPath: '/my path/AGIRAILS.md', network }));
    assert(r.includes("'/my path/AGIRAILS.md'"), 'path with spaces must be single-quoted in bash snippet');
    assert(!r.includes('--config /my path'), 'unquoted path with space must not appear in bash snippet');
  });

  test('generatePublishConfig shell-quotes configPath with shell metacharacters', () => {
    const r = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse({ configPath: '/path/$(evil)/AGIRAILS.md', network }));
    assert(r.includes("'/path/$(evil)/AGIRAILS.md'"), 'metacharacters must be wrapped in single quotes');
    assert(!r.includes('--config /path/$(evil)'), 'unquoted metachar path must not appear');
  });

  test('generatePublishConfig shell-quotes configPath with embedded single quote', () => {
    const r = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse({ configPath: "it's/config.md", network }));
    assert(r.includes("'it'\\''s/config.md'"), "embedded single quote must use the '\\'' idiom");
  });
});

// ── shellQuote unit tests ─────────────────────────────────────────────────────

describe('shellQuote', () => {
  test('wraps a simple path in single quotes', () => {
    assert.equal(shellQuote('AGIRAILS.md'), "'AGIRAILS.md'");
  });

  test('handles paths with spaces', () => {
    assert.equal(shellQuote('/my path/file.md'), "'/my path/file.md'");
  });

  test("handles embedded single quote via the '\\\\'' idiom", () => {
    assert.equal(shellQuote("it's"), "'it'\\''s'");
  });

  test('handles shell metacharacters inside single quotes', () => {
    assert.equal(shellQuote('$(evil)'), "'$(evil)'");
    assert.equal(shellQuote('`rm -rf`'), "'`rm -rf`'");
    assert.equal(shellQuote('a;b'), "'a;b'");
    assert.equal(shellQuote('a|b'), "'a|b'");
  });
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('schema validation', () => {
  test('REQUEST_SERVICE_SCHEMA rejects missing budget', () => {
    assert.throws(
      () => REQUEST_SERVICE_SCHEMA.parse({ service: 'analysis', input: 'do work', network: 'testnet' }),
      /budget/i,
    );
  });

  test('REQUEST_SERVICE_SCHEMA rejects non-numeric budget', () => {
    assert.throws(
      () => REQUEST_SERVICE_SCHEMA.parse({ service: 'analysis', input: 'do work', budget: 'five', network: 'testnet' }),
      /budget/i,
    );
  });

  test('LIST_TRANSACTIONS_SCHEMA rejects invalid state', () => {
    assert.throws(
      () => LIST_TRANSACTIONS_SCHEMA.parse({ state: 'INVALID', network: 'testnet' }),
    );
  });

  test('DELIVER_SCHEMA rejects missing deliverable', () => {
    assert.throws(
      () => DELIVER_SCHEMA.parse({ txId: 'tx-1', network: 'testnet' }),
      /deliverable/i,
    );
  });

  test('DISPUTE_SCHEMA rejects missing reason', () => {
    assert.throws(
      () => DISPUTE_SCHEMA.parse({ txId: 'tx-1', network: 'testnet' }),
      /reason/i,
    );
  });

  // Fix #3 (AGI-32): ACCEPT_QUOTE_SCHEMA now requires quotedPrice
  test('ACCEPT_QUOTE_SCHEMA rejects missing quotedPrice', () => {
    assert.throws(
      () => ACCEPT_QUOTE_SCHEMA.parse({ txId: 'tx-1', network: 'testnet' }),
      /quotedPrice/i,
    );
  });

  // Fix #11 (AGI-40): VERIFY_AGENT_SCHEMA accepts agentSlug (uses getAgentByDID internally)
  test('VERIFY_AGENT_SCHEMA requires agentSlug', () => {
    const result = VERIFY_AGENT_SCHEMA.safeParse({ agentSlug: 'my-agent', network: 'testnet' });
    assert(result.success, 'agentSlug-based verify should parse successfully');
  });
});
