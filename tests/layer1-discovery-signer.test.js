/**
 * Regression test for Fix #15 (AGI-56): buildReadOnlyRegistry() must pass a
 * Signer-backed argument (an ephemeral ethers.Wallet) to AgentRegistry, not a
 * bare JsonRpcProvider.
 *
 * SDK 3.0 requires: new AgentRegistry(address, signer, gasSettings?)
 * A JsonRpcProvider is NOT a Signer — it lacks signTransaction/signMessage/etc.
 *
 * We mock @agirails/sdk and ethers via mock.module() before dynamically
 * importing the compiled module so we can capture what AgentRegistry receives.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Capture AgentRegistry constructor arguments ─────────────────────────────
let capturedRegistryArgs = null;
let mockRegistryInstance = null;

mock.module('@agirails/sdk', {
  namedExports: {
    AgentRegistry: class AgentRegistryMock {
      constructor(address, signerOrProvider) {
        capturedRegistryArgs = { address, signerOrProvider };
        mockRegistryInstance = this;
      }
      computeServiceTypeHash(s) {
        return '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
      }
      async queryAgentsByService() { return []; }
      async getAgent() { return null; }
      async getServiceDescriptors() { return []; }
    },
    getNetwork: (_name) => ({
      rpcUrl: 'http://localhost:8545',
      contracts: {
        agentRegistry: '0x0000000000000000000000000000000000001234',
      },
    }),
  },
});

// Mock ethers: JsonRpcProvider is a plain provider (no Signer methods).
// Wallet.createRandom() must return something with Signer methods and a
// connect() that chains the provider. This mirrors the real ethers behavior.
const FAKE_PROVIDER = {
  // Provider-only — no signTransaction, no getAddress promise
  _isProvider: true,
  sendTransaction: undefined,
  signTransaction: undefined,
};

const FAKE_SIGNER = {
  // Signer-specific methods the SDK checks for
  _isSigner: true,
  signTransaction: async (tx) => '0xsigned',
  signMessage: async (msg) => '0xsignedmsg',
  getAddress: async () => '0xEphemeralWalletAddress',
  provider: FAKE_PROVIDER,
};

mock.module('ethers', {
  namedExports: {
    ethers: {
      JsonRpcProvider: class FakeJsonRpcProvider {
        constructor(rpcUrl) {
          this.rpcUrl = rpcUrl;
          Object.assign(this, FAKE_PROVIDER);
        }
      },
      Wallet: {
        createRandom: () => ({
          connect: (_provider) => FAKE_SIGNER,
        }),
      },
    },
  },
});

// ── Dynamic import AFTER mocks are registered ────────────────────────────────
const { findAgents } = await import('../dist/tools/layer1-discovery.js');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildReadOnlyRegistry() — Fix #15 regression (AGI-56)', () => {
  test('AgentRegistry receives a Signer-backed argument, not a bare Provider', async () => {
    // Call findAgents WITHOUT a custom registryFactory so buildReadOnlyRegistry() runs.
    // The registry returns empty addresses so findAgents exits early — we just need
    // buildReadOnlyRegistry() to run its constructor path.
    await findAgents({ capability: 'translation', limit: 5, network: 'base-mainnet' });

    assert.ok(capturedRegistryArgs !== null, 'AgentRegistry constructor was never called');

    const arg = capturedRegistryArgs.signerOrProvider;

    // The passed argument must have Signer-specific methods.
    assert.ok(
      typeof arg.signTransaction === 'function',
      `expected signTransaction on signer arg, got: ${JSON.stringify(Object.keys(arg))}`,
    );
    assert.ok(
      typeof arg.signMessage === 'function',
      `expected signMessage on signer arg, got: ${JSON.stringify(Object.keys(arg))}`,
    );
    assert.ok(
      typeof arg.getAddress === 'function',
      `expected getAddress on signer arg, got: ${JSON.stringify(Object.keys(arg))}`,
    );

    // It must NOT be the raw provider (which has no signTransaction).
    assert.ok(
      arg.signTransaction !== undefined,
      'raw JsonRpcProvider was passed instead of an ephemeral Wallet signer',
    );
  });

  test('AgentRegistry address comes from getNetwork().contracts.agentRegistry', async () => {
    capturedRegistryArgs = null;
    await findAgents({ capability: 'translation', limit: 5, network: 'base-mainnet' });

    assert.ok(capturedRegistryArgs !== null, 'AgentRegistry constructor was never called');
    assert.equal(
      capturedRegistryArgs.address,
      '0x0000000000000000000000000000000000001234',
      'AgentRegistry address should come from getNetwork().contracts.agentRegistry',
    );
  });

  test('read-only query path completes without a funded private key', async () => {
    // findAgents completes without throwing even though the ephemeral wallet
    // has no real private key and the RPC URL is unreachable — because the mock
    // queryAgentsByService returns [] (no actual eth_call is made in tests).
    const result = await findAgents({ capability: 'translation', limit: 5, network: 'base-mainnet' });
    assert.ok(typeof result === 'string', `expected string result, got: ${typeof result}`);
    // Either "No agents found" (empty registry) or a valid card list — both are acceptable.
    assert.ok(
      result.includes('No agents found') || result.includes('AGIRAILS Agent Registry'),
      `unexpected result: ${result}`,
    );
  });
});
