/**
 * Tests for Layer 2 runtime: escaping safety, generator output, schema validation.
 * Run after build: node --test tests/
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
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

// ── generateRequestService: budget escaping ───────────────────────────────────

describe('generateRequestService', () => {
  const base = { agentSlug: 'test-agent', service: 'do a task', network: 'testnet' };

  test('budget with single quote is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, budget: "5'50" }));
    assert(!result.includes("budget: '5'50'"), 'unescaped single quote must not appear');
    assert(result.includes("budget: '5\\'50'"), 'escaped form must appear');
  });

  test('budget with backslash is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, budget: '5\\50' }));
    assert(result.includes("budget: '5\\\\50'"), 'backslash must be doubled');
  });

  test('budget with newline is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, budget: '5\n50' }));
    assert(result.includes("budget: '5\\n50'"), 'newline must be escaped');
  });

  test('service with single quote is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, budget: '5', service: "don't fail" }));
    assert(!result.includes("service: 'don't fail'"), 'unescaped quote must not appear');
  });

  test('agentSlug with special chars is escaped', () => {
    const result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse({ ...base, budget: '5', agentSlug: "agent'x" }));
    assert(!result.includes("request('agent'x'"), 'unescaped quote in slug must not appear');
  });
});

// ── All generators return non-empty strings ───────────────────────────────────

describe('all generators produce output', () => {
  const txId = 'tx-abc-123';
  const network = 'testnet';

  test('generateInit', () => {
    const r = generateInit(INIT_SCHEMA.parse({ name: 'my-agent', network }));
    assert(r.length > 50);
    assert(r.includes('ACTPClient'));
  });

  test('generatePay x402 path', () => {
    const r = generatePay(PAY_SCHEMA.parse({ target: 'https://api.example.com/pay', amount: '1', network }));
    assert(r.includes('x402'));
  });

  test('generatePay ACTP path', () => {
    const r = generatePay(PAY_SCHEMA.parse({ target: '0xabc123', amount: '1', network }));
    assert(r.includes('kernel.pay'));
  });

  test('generateSubmitQuote', () => {
    const r = generateSubmitQuote(SUBMIT_QUOTE_SCHEMA.parse({ txId, price: '3.00', deliverables: 'a report', network }));
    assert(r.includes('submitQuote'));
  });

  test('generateAcceptQuote', () => {
    const r = generateAcceptQuote(ACCEPT_QUOTE_SCHEMA.parse({ txId, network }));
    assert(r.includes('acceptQuote'));
  });

  test('generateGetTransaction', () => {
    const r = generateGetTransaction(GET_TRANSACTION_SCHEMA.parse({ txId, network }));
    assert(r.includes('getTransaction'));
  });

  test('generateListTransactions', () => {
    const r = generateListTransactions(LIST_TRANSACTIONS_SCHEMA.parse({ network }));
    assert(r.includes('listTransactions'));
  });

  test('generateDeliver', () => {
    const r = generateDeliver(DELIVER_SCHEMA.parse({ txId, deliverable: 'the file', network }));
    assert(r.includes('deliver'));
  });

  test('generateSettle', () => {
    const r = generateSettle(SETTLE_SCHEMA.parse({ txId, network }));
    assert(r.includes('settle'));
  });

  test('generateDispute', () => {
    const r = generateDispute(DISPUTE_SCHEMA.parse({ txId, reason: 'wrong output', network }));
    assert(r.includes('dispute'));
  });

  test('generateCancel', () => {
    const r = generateCancel(CANCEL_SCHEMA.parse({ txId, network }));
    assert(r.includes('cancel'));
  });

  test('generateGetBalance', () => {
    const r = generateGetBalance(GET_BALANCE_SCHEMA.parse({ network }));
    assert(r.includes('getBalance'));
  });

  test('generateVerifyAgent', () => {
    const r = generateVerifyAgent(VERIFY_AGENT_SCHEMA.parse({ agentSlug: 'my-agent', network }));
    assert(r.includes('registry.verify'));
  });

  test('generatePublishConfig', () => {
    const r = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse({ network }));
    assert(r.includes('publishConfig'));
  });
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('schema validation', () => {
  test('REQUEST_SERVICE_SCHEMA rejects missing budget', () => {
    assert.throws(
      () => REQUEST_SERVICE_SCHEMA.parse({ agentSlug: 'a', service: 'b', network: 'testnet' }),
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
});
