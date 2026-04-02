import { z } from 'zod';

// ─── Layer 2: Agent Commerce Runtime ─────────────────────────────────────────
// All live transaction calls go through @agirails/sdk on the user's machine.
// The MCP server constructs the call and returns code/instructions.
// For direct execution, the user needs @agirails/sdk installed and configured.

// Shared schemas
const NetworkSchema = z.enum(['mainnet', 'testnet']).default('testnet');
const TxIdSchema = z.string().describe('Transaction ID returned by agirails_request_service or agirails_list_transactions');

// ── Tool schemas ──────────────────────────────────────────────────────────────

// Fix #14 + Config: removed `overwrite` (not in ACTPClientConfig) and kept `name` for agent label only
export const INIT_SCHEMA = z.object({
  name: z.string().describe('Human-readable name for this agent'),
  network: NetworkSchema,
});

export const REQUEST_SERVICE_SCHEMA = z.object({
  agentSlug: z.string().describe('Target agent slug. Use agirails_find_agents to discover available agents.'),
  service: z.string().describe('What you want the agent to do. Be specific — this becomes the job description.'),
  budget: z.string().describe('Max USDC willing to pay (e.g. "5", "10.50"). Funds are locked in escrow only after quote acceptance.'),
  network: NetworkSchema,
});

export const PAY_SCHEMA = z.object({
  target: z.string().describe('Agent address (0x...), HTTPS endpoint, or agent slug. Smart pay selects ACTP vs x402 automatically.'),
  amount: z.string().describe('USDC amount to send (e.g. "1", "0.50")'),
  service: z.string().optional().describe('Optional: service description for ACTP transactions'),
  network: NetworkSchema,
});

export const SUBMIT_QUOTE_SCHEMA = z.object({
  txId: TxIdSchema,
  price: z.string().describe('Quoted price in USDC (e.g. "3.00")'),
  deliverables: z.string().describe('What will be delivered (description of the output)'),
  estimatedDelivery: z.string().optional().describe('Estimated delivery time (e.g. "2 hours", "by end of day")'),
  network: NetworkSchema,
});

// Fix #3: added quotedPrice required for client.standard.acceptQuote(txId, newAmount)
export const ACCEPT_QUOTE_SCHEMA = z.object({
  txId: TxIdSchema,
  quotedPrice: z.string().describe('The quoted price in USDC to accept (e.g. "3.00")'),
  network: NetworkSchema,
});

export const GET_TRANSACTION_SCHEMA = z.object({
  txId: TxIdSchema,
  network: NetworkSchema,
});

export const LIST_TRANSACTIONS_SCHEMA = z.object({
  state: z.enum(['all', 'INITIATED', 'QUOTED', 'COMMITTED', 'IN_PROGRESS', 'DELIVERED', 'SETTLED', 'DISPUTED', 'CANCELLED']).default('all'),
  role: z.enum(['all', 'requester', 'provider']).default('all'),
  limit: z.number().int().min(1).max(100).default(20),
  network: NetworkSchema,
});

export const DELIVER_SCHEMA = z.object({
  txId: TxIdSchema,
  deliverable: z.string().describe('What was delivered — include the result, CID, URL, or a summary.'),
  network: NetworkSchema,
});

export const SETTLE_SCHEMA = z.object({
  txId: TxIdSchema,
  network: NetworkSchema,
});

export const DISPUTE_SCHEMA = z.object({
  txId: TxIdSchema,
  reason: z.string().describe('Why you are disputing this transaction. Be specific — this goes on-chain.'),
  network: NetworkSchema,
});

export const CANCEL_SCHEMA = z.object({
  txId: TxIdSchema,
  network: NetworkSchema,
});

export const GET_BALANCE_SCHEMA = z.object({
  network: NetworkSchema,
});

export const VERIFY_AGENT_SCHEMA = z.object({
  agentSlug: z.string().describe('Agent slug to verify on-chain (AgentRegistry.sol)'),
  network: NetworkSchema,
});

export const PUBLISH_CONFIG_SCHEMA = z.object({
  configPath: z.string().default('AGIRAILS.md').describe('Path to your AGIRAILS.md file'),
  network: NetworkSchema,
});

// ── Code generators ───────────────────────────────────────────────────────────
// Each tool returns a TypeScript code snippet + explanation.
// Agents with @agirails/sdk can execute these directly.

/** Escape a user-supplied string for safe embedding in a single-quoted TS literal. */
export function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// Fix #14 + Config: removed agentName/overwrite (not in ACTPClientConfig v3.0);
// use client.getAddress() and client.info instead of client.agentAddress/agentId
export function generateInit(params: z.infer<typeof INIT_SCHEMA>): string {
  return `## Initialize AGIRAILS Client

This creates an ACTPClient connected to the AGIRAILS network.

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

// Store your agent label for display purposes
const agentLabel = '${esc(params.name)}';

const client = await ACTPClient.create({
  mode: '${params.network}',
});

console.log('Agent address:', client.getAddress());
console.log('Client info:', client.info);
\`\`\`

> **Note:** Your private key is stored locally in the keystore. Never share it.
> Fund your agent address with USDC (Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'}) before committing to transactions.`;
}

// Fix #21: changed agent.on('transaction:quoted') → agent.on('payment:received')
export function generateRequestService(params: z.infer<typeof REQUEST_SERVICE_SCHEMA>): string {
  return `## Request Service from ${esc(params.agentSlug)}

Initiates an ACTP transaction. Funds are NOT locked until you accept a quote.

\`\`\`typescript
import { Agent } from '@agirails/sdk';

const agent = new Agent({ network: '${params.network}' });
await agent.start();

// Initiate — moves to INITIATED state, provider will respond with quote
const { txId } = await agent.request('${esc(params.agentSlug)}', {
  service: '${esc(params.service)}',
  budget: '${esc(params.budget)}',  // max USDC (locks only after quote acceptance)
});

console.log('Transaction ID:', txId);
console.log('Status: INITIATED — waiting for provider quote');

// Notified when provider accepts and payment flows
agent.on('payment:received', (amount) => {
  console.log(\`Payment received: \${amount} USDC\`);
  // Accept with: agirails_accept_quote({ txId, quotedPrice: amount, network: '${params.network}' })
});
\`\`\`

> **Next step:** Use \`agirails_get_transaction\` to check status, or \`agirails_accept_quote\` to lock escrow.`;
}

// Fix #1: client.kernel.pay() → client.pay() (root-level unified pay on ACTPClient)
// Fix #10: client.x402.pay() → client.pay({ to: url, amount }) — auto-routes to X402Adapter for HTTP endpoints
export function generatePay(params: z.infer<typeof PAY_SCHEMA>): string {
  const isX402 = params.target.startsWith('https://');
  const isAddress = params.target.startsWith('0x');

  if (isX402) {
    return `## Smart Pay via x402 (instant HTTP payment)

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// x402 instant payment — client.pay() auto-routes HTTP endpoints through X402Adapter
const result = await client.pay({
  to: '${esc(params.target)}',
  amount: '${esc(params.amount)}',
});

console.log('Payment result:', result);
\`\`\`

> x402 payments are instant and atomic. No escrow, no dispute window.`;
  }

  return `## Smart Pay to ${isAddress ? 'address' : 'agent'}

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// IMPORTANT: client.pay() returns at COMMITTED state — escrow is locked, not settled.
// You MUST complete the lifecycle: startWork → deliver → release.
const result = await client.pay({
  to: '${esc(params.target)}',
  amount: '${esc(params.amount)}',
  ${params.service ? `service: '${esc(params.service)}',` : ''}
});

console.log('Transaction ID:', result.txId);
console.log('State:', result.state); // 'COMMITTED'

// Complete the lifecycle
await client.startWork(result.txId);
await client.deliver(result.txId);
// After dispute window expires:
await client.release(result.escrowId!);
\`\`\``;
}

// Fix #2: client.kernel.submitQuote() → client.advanced.transitionState(txId, 'QUOTED')
// Price and deliverables are communicated to the requester out of band (ACTP protocol messaging).
export function generateSubmitQuote(params: z.infer<typeof SUBMIT_QUOTE_SCHEMA>): string {
  return `## Submit Quote (INITIATED → QUOTED)

As the provider, transition the transaction to QUOTED state. Communicate price and deliverables to the requester out of band.

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Transition state to QUOTED (provider signals readiness to work at quoted price)
await client.advanced.transitionState('${esc(params.txId)}', 'QUOTED');

// Communicate to requester (off-chain):
// Price: ${esc(params.price)} USDC
// Deliverables: ${esc(params.deliverables)}
${params.estimatedDelivery ? `// Estimated delivery: ${esc(params.estimatedDelivery)}` : ''}

console.log('Quote submitted. Waiting for requester to accept.');
\`\`\`

> Requester will see this state change and can call \`agirails_accept_quote\` to lock escrow.`;
}

// Fix #3: client.kernel.acceptQuote() → client.standard.acceptQuote(txId, newAmount) + client.standard.linkEscrow(txId)
export function generateAcceptQuote(params: z.infer<typeof ACCEPT_QUOTE_SCHEMA>): string {
  return `## Accept Quote (QUOTED → COMMITTED)

Accepts the provider's quote and locks USDC in escrow:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Accept the quoted price (state stays QUOTED, amount updated)
await client.standard.acceptQuote('${esc(params.txId)}', '${esc(params.quotedPrice)}');

// Link escrow — transitions QUOTED → COMMITTED and locks funds
const escrowId = await client.standard.linkEscrow('${esc(params.txId)}');

console.log('Quote accepted. Escrow locked. Provider can now begin work.');
console.log('Escrow ID:', escrowId);
\`\`\`

> Once committed, escrow is locked. Use \`agirails_dispute\` if the work is unsatisfactory.`;
}

// Fix #4: client.kernel.getTransaction() → client.advanced.getTransaction(txId)
export function generateGetTransaction(params: z.infer<typeof GET_TRANSACTION_SCHEMA>): string {
  return `## Get Transaction Status

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });
const tx = await client.advanced.getTransaction('${esc(params.txId)}');

if (!tx) {
  console.log('Transaction not found');
} else {
  console.log('State:', tx.state);
  console.log('Requester:', tx.requester);
  console.log('Provider:', tx.provider);
  console.log('Amount:', tx.amount);
}

// State flow: INITIATED → QUOTED → COMMITTED → IN_PROGRESS → DELIVERED → SETTLED
// Or: INITIATED/QUOTED/COMMITTED → CANCELLED
// Or: DELIVERED → DISPUTED → SETTLED/CANCELLED
\`\`\``;
}

// Fix #5: client.kernel.listTransactions() → client.advanced.getAllTransactions()
// getAllTransactions() has no filter params; filtering is applied client-side
export function generateListTransactions(params: z.infer<typeof LIST_TRANSACTIONS_SCHEMA>): string {
  const hasFilter = params.state !== 'all' || params.role !== 'all';
  return `## List Transactions

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// getAllTransactions() returns all transactions; filter client-side
const allTransactions = await client.advanced.getAllTransactions();
${hasFilter ? `
// Apply filters
const transactions = allTransactions
${params.state !== 'all' ? `  .filter((tx) => tx.state === '${params.state}')` : ''}${params.role !== 'all' ? `
  // Note: filter by role (requester/provider) using client.getAddress()` : ''}
  .slice(0, ${params.limit});` : `
const transactions = allTransactions.slice(0, ${params.limit});`}

for (const tx of transactions) {
  console.log(\`[\${tx.state}] \${tx.id} — \${tx.amount}\`);
}
\`\`\``;
}

// Fix #6: client.kernel.deliver() → client.deliver(txId) (root-level on ACTPClient)
export function generateDeliver(params: z.infer<typeof DELIVER_SCHEMA>): string {
  return `## Mark Delivered (IN_PROGRESS → DELIVERED)

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Transition to DELIVERED state
await client.deliver('${esc(params.txId)}');

// Communicate deliverable to requester (off-chain):
// ${esc(params.deliverable)}

console.log('Marked as DELIVERED. Requester has a dispute window to review.');
\`\`\`

> After delivery, the requester can settle (releases escrow) or dispute (bonds 5%, oracle reviews).`;
}

// Fix #7: client.kernel.settle() → client.release(escrowId) (escrowId is usually same as txId)
export function generateSettle(params: z.infer<typeof SETTLE_SCHEMA>): string {
  return `## Settle Transaction (DELIVERED → SETTLED)

Releases escrowed USDC to the provider:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// release() requires the escrow ID (usually same as txId) and that the dispute window has expired
await client.release('${esc(params.txId)}');

console.log('Transaction settled. USDC released to provider.');
\`\`\`

> Settling also updates the provider's ERC-8004 reputation score.`;
}

// Fix #8: client.kernel.dispute() → client.advanced.transitionState(txId, 'DISPUTED')
// Dispute reason is communicated off-chain (reason param kept for user reference)
export function generateDispute(params: z.infer<typeof DISPUTE_SCHEMA>): string {
  return `## Dispute Transaction (DELIVERED → DISPUTED)

Raises an AIP-14 dispute. Requires a 5% bond; resolved by oracle:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Transition to DISPUTED state (bonds 5% of escrow)
await client.advanced.transitionState('${esc(params.txId)}', 'DISPUTED');

// Dispute reason (submit off-chain to oracle):
// ${esc(params.reason)}

console.log('Dispute raised. AIP-14 oracle will resolve.');
console.log('Note: 5% of escrow posted as dispute bond.');
\`\`\`

> Oracle resolution typically takes 24-72 hours. Both parties can submit evidence.`;
}

// Fix #9: client.kernel.cancel() → client.advanced.transitionState(txId, 'CANCELLED')
export function generateCancel(params: z.infer<typeof CANCEL_SCHEMA>): string {
  return `## Cancel Transaction

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.advanced.transitionState('${esc(params.txId)}', 'CANCELLED');

console.log('Transaction cancelled. Escrow (if any) returned to requester.');
\`\`\`

> Transactions in INITIATED, QUOTED, or COMMITTED state can be cancelled. After IN_PROGRESS/DELIVERED, use \`agirails_dispute\` instead.`;
}

// Fix #13: client.getBalance() → client.getBalance(address) — takes address string, returns USDC wei string
export function generateGetBalance(params: z.infer<typeof GET_BALANCE_SCHEMA>): string {
  return `## Get USDC Balance

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// getBalance() takes an address string and returns balance in USDC wei (6 decimals)
const balanceWei = await client.getBalance(client.getAddress());
const balanceUsdc = Number(balanceWei) / 1_000_000;
console.log('USDC balance:', balanceUsdc.toFixed(6), 'USDC');
\`\`\`

> Fund your agent at: https://www.agirails.app/fund (Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'})`;
}

// Fix #11: client.registry.verify() → standalone AgentRegistry with getAgent(address) or getAgentByDID(did)
export function generateVerifyAgent(params: z.infer<typeof VERIFY_AGENT_SCHEMA>): string {
  return `## Verify Agent On-Chain (AgentRegistry)

Checks AIP-7 on-chain registration via a standalone AgentRegistry instance:

\`\`\`typescript
import { AgentRegistry, getNetwork } from '@agirails/sdk';
import { ethers } from 'ethers';

const networkConfig = getNetwork('${params.network === 'mainnet' ? 'base-mainnet' : 'base-sepolia'}');
const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new AgentRegistry(networkConfig.contracts.agentRegistry!, provider as any);

// Look up by DID (e.g. 'did:agirails:${esc(params.agentSlug)}') or by on-chain address
const profile = await registry.getAgentByDID('did:agirails:${esc(params.agentSlug)}');

if (!profile) {
  console.log('Agent not found on-chain for slug: ${esc(params.agentSlug)}');
} else {
  console.log('Agent address:', profile.agentAddress);
  console.log('DID:', profile.did);
  console.log('Config hash:', profile.configHash);
  console.log('Reputation score:', profile.reputationScore);
  console.log('Active:', profile.isActive);
}
\`\`\`

> On-chain verification ensures the agent's configuration hasn't been tampered with.`;
}

// Fix #12: client.registry.publishConfig() not exported — direct users to npx agirails publish CLI
export function generatePublishConfig(params: z.infer<typeof PUBLISH_CONFIG_SCHEMA>): string {
  return `## Publish Agent Config (AIP-7)

The recommended way to publish your AGIRAILS.md config on-chain is via the AGIRAILS CLI.
The CLI uploads to IPFS, computes the config hash, and registers it via AgentRegistry in one step:

\`\`\`bash
# Install CLI (if not already installed)
npm install -g @agirails/sdk

# Publish config from ${esc(params.configPath)}
npx agirails publish --config ${esc(params.configPath)} --network ${params.network}
\`\`\`

The CLI will:
1. Read your \`${esc(params.configPath)}\`
2. Upload content to IPFS and compute SHA-256 hash
3. Call \`AgentRegistry.publishConfig(cid, hash)\` on-chain
4. Print the IPFS CID and transaction hash

> Any AI reading your AGIRAILS.md (via Agent Card) will know exactly how to work with your agent.`;
}
