import { z } from 'zod';

// ─── Layer 2: Agent Commerce Runtime ─────────────────────────────────────────
// All live transaction calls go through @agirails/sdk on the user's machine.
// The MCP server constructs the call and returns code/instructions.
// For direct execution, the user needs @agirails/sdk installed and configured.

// Shared schemas
const NetworkSchema = z.enum(['mainnet', 'testnet']).default('testnet');
const TxIdSchema = z.string().describe('Transaction ID returned by agirails_request_service or agirails_list_transactions');

// ── Tool schemas ──────────────────────────────────────────────────────────────

export const INIT_SCHEMA = z.object({
  name: z.string().describe('Human-readable name for this agent'),
  network: NetworkSchema,
  overwrite: z.boolean().default(false).describe('Overwrite existing keystore if present'),
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

export const ACCEPT_QUOTE_SCHEMA = z.object({
  txId: TxIdSchema,
  newAmount: z.string().describe('Agreed amount in USDC to lock in escrow (e.g. "3.00")'),
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
  agentAddress: z.string().describe('Agent Ethereum address (0x...) to verify on-chain via AgentRegistry'),
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

// Fix #14: Removed invalid agentName and overwrite from ACTPClient.create() config.
// Removed non-existent client.agentAddress and client.agentId properties.
// Use client.getAddress() and client.info instead. (AGI-43)
export function generateInit(params: z.infer<typeof INIT_SCHEMA>): string {
  return `## Initialize AGIRAILS Keystore

This creates a secure AIP-13 keystore and registers your agent on-chain (gasless via ERC-4337).

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({
  mode: '${params.network}',
});

console.log('Agent address:', client.getAddress());
console.log('Agent info:', client.info);
\`\`\`

> **Note:** Your private key is stored locally in the keystore. Never share it.
> Fund your agent address with USDC (Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'}) before committing to transactions.`;
}

export function generateRequestService(params: z.infer<typeof REQUEST_SERVICE_SCHEMA>): string {
  return `## Request Service from ${esc(params.agentSlug)}

Initiates an ACTP transaction. Funds are NOT locked until you accept a quote.

\`\`\`typescript
import { Agent } from '@agirails/sdk';

const agent = new Agent({ network: '${params.network}' });
await agent.start();

// Initiate — moves to INITIATED state, provider will respond with quote
const { txId } = await agent.request('${esc(params.service)}', {
  service: '${esc(params.service)}',
  budget: '${esc(params.budget)}',  // max USDC (locks only after quote acceptance)
  network: '${params.network}',
});

console.log('Transaction ID:', txId);
console.log('Status: INITIATED — waiting for provider quote');

// Wait for quote (job:received is emitted when provider responds)
agent.on('job:received', async (job) => {
  console.log(\`Job received: \${job.id}\`);
  console.log('Budget:', job.budget, 'USDC');
  // Accept with: agirails_accept_quote({ txId, newAmount, network: '${params.network}' })
});
\`\`\`

> **Next step:** Use \`agirails_get_transaction\` to check status, or \`agirails_accept_quote\` to lock escrow.`;
}

// Fix #10: client.x402.pay() → X402Adapter standalone + client.pay({ to: url, amount })
// Fix #1:  client.kernel.pay() → client.pay({ to, amount })
// (AGI-39, AGI-30)
export function generatePay(params: z.infer<typeof PAY_SCHEMA>): string {
  const isX402 = params.target.startsWith('https://');
  const isAddress = params.target.startsWith('0x');

  if (isX402) {
    return `## Smart Pay via x402 (instant HTTP payment)

\`\`\`typescript
import { ACTPClient, X402Adapter } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Register X402Adapter for HTTPS endpoints
client.registerAdapter(new X402Adapter(client.getAddress(), {
  expectedNetwork: '${params.network}',
}));

// client.pay() auto-routes to x402 for HTTPS URLs
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

const result = await client.pay({
  to: '${esc(params.target)}',
  amount: '${esc(params.amount)}',
  ${params.service ? `metadata: { serviceDescription: '${esc(params.service)}' },` : ''}
});

console.log('Transaction ID:', result.txId);
\`\`\``;
}

// Fix #2: client.kernel.submitQuote() → client.advanced.transitionState(txId, 'QUOTED') (AGI-31)
export function generateSubmitQuote(params: z.infer<typeof SUBMIT_QUOTE_SCHEMA>): string {
  return `## Submit Quote (INITIATED → QUOTED)

As the provider, transition the transaction to QUOTED state:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Transition to QUOTED state
await client.advanced.transitionState('${esc(params.txId)}', 'QUOTED');

console.log('Transaction moved to QUOTED state.');
console.log('Price: ${esc(params.price)} USDC');
console.log('Deliverables: ${esc(params.deliverables)}');
${params.estimatedDelivery ? `console.log('Estimated delivery: ${esc(params.estimatedDelivery)}');` : ''}
\`\`\`

> Requester will see this state change and can accept (locks escrow) or ignore it.`;
}

// Fix #3: client.kernel.acceptQuote() → client.standard.acceptQuote(txId, newAmount) + linkEscrow() (AGI-32)
export function generateAcceptQuote(params: z.infer<typeof ACCEPT_QUOTE_SCHEMA>): string {
  return `## Accept Quote (QUOTED → COMMITTED)

Accepts the provider's quote and locks USDC in escrow:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// Accept the quote with the agreed amount
await client.standard.acceptQuote('${esc(params.txId)}', '${esc(params.newAmount)}');

// Lock funds in escrow → transitions to COMMITTED
await client.standard.linkEscrow('${esc(params.txId)}');

console.log('Quote accepted. Escrow locked. Provider can now begin work.');
\`\`\`

> Once committed, escrow is locked. Use \`agirails_dispute\` if the work is unsatisfactory.`;
}

// Fix #4: client.kernel.getTransaction() → client.advanced.getTransaction(txId) (AGI-33)
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
  console.log('Amount:', tx.amount);
  console.log('Requester:', tx.requester);
  console.log('Provider:', tx.provider);
  console.log('Service:', tx.serviceDescription);
}

// State flow: INITIATED → QUOTED → COMMITTED → IN_PROGRESS → DELIVERED → SETTLED
// Or: INITIATED/QUOTED/COMMITTED → CANCELLED
// Or: DELIVERED → DISPUTED → SETTLED/CANCELLED
\`\`\``;
}

// Fix #5: client.kernel.listTransactions() → client.advanced.getAllTransactions() (AGI-34)
// getAllTransactions() has no filter params — apply client-side filtering
export function generateListTransactions(params: z.infer<typeof LIST_TRANSACTIONS_SCHEMA>): string {
  const hasStateFilter = params.state !== 'all';
  const hasRoleFilter = params.role !== 'all';

  return `## List Transactions

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// getAllTransactions() returns all transactions; filter client-side
let transactions = await client.advanced.getAllTransactions();
${hasStateFilter ? `\ntransactions = transactions.filter(tx => tx.state === '${params.state}');` : ''}
${hasRoleFilter ? `\nconst myAddress = client.getAddress();\ntransactions = transactions.filter(tx =>\n  ${params.role === 'requester' ? 'tx.requester?.toLowerCase() === myAddress.toLowerCase()' : 'tx.provider?.toLowerCase() === myAddress.toLowerCase()'}\n);` : ''}

// Apply limit
transactions = transactions.slice(0, ${params.limit});

for (const tx of transactions) {
  console.log(\`[\${tx.state}] \${tx.id} — \${tx.amount} — \${tx.serviceDescription}\`);
}
\`\`\``;
}

// Fix #6: client.kernel.deliver() → client.deliver(txId) (AGI-35)
export function generateDeliver(params: z.infer<typeof DELIVER_SCHEMA>): string {
  return `## Mark Delivered (IN_PROGRESS → DELIVERED)

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.deliver('${esc(params.txId)}');

console.log('Marked as DELIVERED. Requester has a dispute window to review.');
console.log('Deliverable: ${esc(params.deliverable)}');
\`\`\`

> After delivery, the requester can settle (releases escrow) or dispute (bonds 5%, oracle reviews).`;
}

// Fix #7: client.kernel.settle() → client.release(escrowId) (AGI-36)
export function generateSettle(params: z.infer<typeof SETTLE_SCHEMA>): string {
  return `## Settle Transaction (DELIVERED → SETTLED)

Releases escrowed USDC to the provider:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// release() is explicit — must be called after dispute window expires
await client.release('${esc(params.txId)}');

console.log('Transaction settled. USDC released to provider.');
\`\`\`

> Settling also updates the provider's ERC-8004 reputation score.`;
}

// Fix #8: client.kernel.dispute() → client.advanced.transitionState(txId, 'DISPUTED') (AGI-37)
export function generateDispute(params: z.infer<typeof DISPUTE_SCHEMA>): string {
  return `## Dispute Transaction (DELIVERED → DISPUTED)

Raises an AIP-14 dispute. Requires a 5% bond; resolved by oracle:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.advanced.transitionState('${esc(params.txId)}', 'DISPUTED');

console.log('Dispute raised. AIP-14 oracle will resolve.');
console.log('Reason: ${esc(params.reason)}');
console.log('Note: 5% of escrow posted as dispute bond.');
\`\`\`

> Oracle resolution typically takes 24-72 hours. Both parties can submit evidence.`;
}

// Fix #9: client.kernel.cancel() → client.advanced.transitionState(txId, 'CANCELLED') (AGI-38)
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

// Fix #13: client.getBalance() no-arg → client.getBalance(address: string) returns string (AGI-42)
export function generateGetBalance(params: z.infer<typeof GET_BALANCE_SCHEMA>): string {
  return `## Get USDC Balance

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

const address = client.getAddress();
const balanceWei = await client.getBalance(address);

// Convert from wei (6 decimals) to USDC
const balanceUSDC = (Number(balanceWei) / 1_000_000).toFixed(2);
console.log('USDC balance:', balanceUSDC, 'USDC');
\`\`\`

> Fund your agent at: https://www.agirails.app/fund (Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'})`;
}

// Fix #11: client.registry.verify() → standalone AgentRegistry with Signer (AGI-40)
export function generateVerifyAgent(params: z.infer<typeof VERIFY_AGENT_SCHEMA>): string {
  return `## Verify Agent On-Chain (AgentRegistry)

Checks AIP-7 on-chain registration: DID, endpoint, reputation:

\`\`\`typescript
import { AgentRegistry, getNetwork } from '@agirails/sdk';
import { ethers } from 'ethers';

const networkConfig = getNetwork('${params.network}');
const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

// AgentRegistry requires a Signer — use a random wallet for read-only queries
const readSigner = ethers.Wallet.createRandom().connect(provider);
const registry = new AgentRegistry(networkConfig.contracts.agentRegistry, readSigner);

const profile = await registry.getAgent('${esc(params.agentAddress)}');

if (!profile) {
  console.log('Agent not registered on-chain');
} else {
  console.log('DID:', profile.did);
  console.log('Endpoint:', profile.endpoint);
  console.log('Reputation score:', profile.reputationScore);
  console.log('Total transactions:', profile.totalTransactions);
  console.log('Active:', profile.isActive);
}
\`\`\`

> On-chain verification ensures the agent's configuration hasn't been tampered with.`;
}

// Fix #12: client.registry.publishConfig() → agirails publish CLI (AGI-41)
export function generatePublishConfig(params: z.infer<typeof PUBLISH_CONFIG_SCHEMA>): string {
  return `## Publish Agent Config (AIP-7)

Publishes your AGIRAILS.md to IPFS and registers the CID on-chain.

Use the \`agirails\` CLI (included with \`@agirails/sdk\`):

\`\`\`bash
# Publish your AGIRAILS.md config on-chain
npx agirails publish --path ${esc(params.configPath)} --network ${params.network}
\`\`\`

The CLI will:
1. Parse and validate your \`${esc(params.configPath)}\`
2. Upload to IPFS (Filebase)
3. Register the config hash on-chain via AgentRegistry

> **Requires:** \`FILEBASE_ACCESS_KEY\` and \`FILEBASE_SECRET_KEY\` env vars for IPFS upload.
> **Network:** Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'}
> Your agent will be publicly discoverable after publishing.`;
}
