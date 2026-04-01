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

export function generateInit(params: z.infer<typeof INIT_SCHEMA>): string {
  return `## Initialize AGIRAILS Keystore

This creates a secure AIP-13 keystore and registers your agent on-chain (gasless via ERC-4337).

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({
  mode: '${params.network}',
  agentName: '${esc(params.name)}',
  ${params.overwrite ? 'overwrite: true,' : ''}
});

console.log('Agent address:', client.agentAddress);
console.log('Agent ID:', client.agentId);
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
const { txId } = await agent.request('${esc(params.agentSlug)}', {
  service: '${esc(params.service)}',
  budget: '${esc(params.budget)}',  // max USDC (locks only after quote acceptance)
});

console.log('Transaction ID:', txId);
console.log('Status: INITIATED — waiting for provider quote');

// Wait for quote
agent.on('transaction:quoted', async (tx) => {
  if (tx.id === txId) {
    console.log(\`Quote received: $\${tx.quotedAmount} USDC\`);
    console.log('Deliverables:', tx.deliverables);
    // Accept with: agirails_accept_quote({ txId, network: '${params.network}' })
  }
});
\`\`\`

> **Next step:** Use \`agirails_get_transaction\` to check status, or \`agirails_accept_quote\` to lock escrow.`;
}

export function generatePay(params: z.infer<typeof PAY_SCHEMA>): string {
  const isX402 = params.target.startsWith('https://');
  const isAddress = params.target.startsWith('0x');

  if (isX402) {
    return `## Smart Pay via x402 (instant HTTP payment)

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

// x402 instant payment — atomically splits fee and forwards to endpoint
const result = await client.x402.pay({
  url: '${esc(params.target)}',
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

const txId = await client.kernel.pay({
  to: '${esc(params.target)}',
  amount: '${esc(params.amount)}',
  ${params.service ? `service: '${esc(params.service)}',` : ''}
});

console.log('Transaction ID:', txId);
\`\`\``;
}

export function generateSubmitQuote(params: z.infer<typeof SUBMIT_QUOTE_SCHEMA>): string {
  return `## Submit Quote (INITIATED → QUOTED)

As the provider, submit your price and deliverables:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.submitQuote({
  txId: '${esc(params.txId)}',
  price: '${esc(params.price)}',  // USDC
  deliverables: '${esc(params.deliverables)}',
  ${params.estimatedDelivery ? `estimatedDelivery: '${esc(params.estimatedDelivery)}',` : ''}
});

console.log('Quote submitted. Waiting for requester to accept.');
\`\`\`

> Requester will see this quote and can accept (locks escrow) or ignore it.`;
}

export function generateAcceptQuote(params: z.infer<typeof ACCEPT_QUOTE_SCHEMA>): string {
  return `## Accept Quote (QUOTED → COMMITTED)

Accepts the provider's quote and locks USDC in escrow:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.acceptQuote({ txId: '${esc(params.txId)}' });

console.log('Quote accepted. Escrow locked. Provider can now begin work.');
\`\`\`

> Once committed, escrow is locked. Use \`agirails_dispute\` if the work is unsatisfactory.`;
}

export function generateGetTransaction(params: z.infer<typeof GET_TRANSACTION_SCHEMA>): string {
  return `## Get Transaction Status

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });
const tx = await client.kernel.getTransaction('${esc(params.txId)}');

console.log('State:', tx.state);
console.log('Escrow balance:', tx.escrowBalance, 'USDC');
console.log('Requester:', tx.requester);
console.log('Provider:', tx.provider);
console.log('Service:', tx.service);
if (tx.deliverables) console.log('Deliverables:', tx.deliverables);

// State flow: INITIATED → QUOTED → COMMITTED → IN_PROGRESS → DELIVERED → SETTLED
// Or: INITIATED/QUOTED/COMMITTED → CANCELLED
// Or: DELIVERED → DISPUTED → SETTLED/CANCELLED
\`\`\``;
}

export function generateListTransactions(params: z.infer<typeof LIST_TRANSACTIONS_SCHEMA>): string {
  return `## List Transactions

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

const transactions = await client.kernel.listTransactions({
  ${params.state !== 'all' ? `state: '${params.state}',` : ''}
  ${params.role !== 'all' ? `role: '${params.role}',` : ''}
  limit: ${params.limit},
});

for (const tx of transactions) {
  console.log(\`[\${tx.state}] \${tx.id} — $\${tx.escrowBalance} USDC — \${tx.service}\`);
}
\`\`\``;
}

export function generateDeliver(params: z.infer<typeof DELIVER_SCHEMA>): string {
  return `## Mark Delivered (IN_PROGRESS → DELIVERED)

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.deliver({
  txId: '${esc(params.txId)}',
  deliverable: '${esc(params.deliverable)}',
});

console.log('Marked as DELIVERED. Requester has a dispute window to review.');
\`\`\`

> After delivery, the requester can settle (releases escrow) or dispute (bonds 5%, oracle reviews).`;
}

export function generateSettle(params: z.infer<typeof SETTLE_SCHEMA>): string {
  return `## Settle Transaction (DELIVERED → SETTLED)

Releases escrowed USDC to the provider:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.settle({ txId: '${esc(params.txId)}' });

console.log('Transaction settled. USDC released to provider.');
\`\`\`

> Settling also updates the provider's ERC-8004 reputation score.`;
}

export function generateDispute(params: z.infer<typeof DISPUTE_SCHEMA>): string {
  return `## Dispute Transaction (DELIVERED → DISPUTED)

Raises an AIP-14 dispute. Requires a 5% bond; resolved by oracle:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.dispute({
  txId: '${esc(params.txId)}',
  reason: '${esc(params.reason)}',
});

console.log('Dispute raised. AIP-14 oracle will resolve.');
console.log('Note: 5% of escrow posted as dispute bond.');
\`\`\`

> Oracle resolution typically takes 24-72 hours. Both parties can submit evidence.`;
}

export function generateCancel(params: z.infer<typeof CANCEL_SCHEMA>): string {
  return `## Cancel Transaction

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

await client.kernel.cancel({ txId: '${esc(params.txId)}' });

console.log('Transaction cancelled. Escrow (if any) returned to requester.');
\`\`\`

> Transactions in INITIATED, QUOTED, or COMMITTED state can be cancelled. After IN_PROGRESS/DELIVERED, use \`agirails_dispute\` instead.`;
}

export function generateGetBalance(params: z.infer<typeof GET_BALANCE_SCHEMA>): string {
  return `## Get USDC Balance

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

const balance = await client.getBalance();
console.log('USDC balance:', balance.usdc, 'USDC');
console.log('Locked in escrow:', balance.locked, 'USDC');
console.log('Available:', balance.available, 'USDC');
\`\`\`

> Fund your agent at: https://www.agirails.app/fund (Base ${params.network === 'mainnet' ? 'Mainnet' : 'Sepolia'})`;
}

export function generateVerifyAgent(params: z.infer<typeof VERIFY_AGENT_SCHEMA>): string {
  return `## Verify Agent On-Chain (AgentRegistry)

Checks AIP-7 on-chain registration: agentId, config_hash, DID:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';

const client = await ACTPClient.create({ mode: '${params.network}' });

const verification = await client.registry.verify('${esc(params.agentSlug)}');

console.log('Agent ID:', verification.agentId);
console.log('DID:', verification.did);
console.log('Config hash:', verification.configHash);
console.log('Reputation score:', verification.reputationScore);
console.log('Registered at:', verification.registeredAt);
\`\`\`

> On-chain verification ensures the agent's configuration hasn't been tampered with.`;
}

export function generatePublishConfig(params: z.infer<typeof PUBLISH_CONFIG_SCHEMA>): string {
  return `## Publish Agent Config (AIP-7)

Publishes your AGIRAILS.md to IPFS and registers the CID on-chain:

\`\`\`typescript
import { ACTPClient } from '@agirails/sdk';
import { readFileSync } from 'fs';

const client = await ACTPClient.create({ mode: '${params.network}' });
const configContent = readFileSync('${esc(params.configPath)}', 'utf-8');

const { cid, txHash } = await client.registry.publishConfig({
  content: configContent,
});

console.log('Published to IPFS:', cid);
console.log('On-chain tx:', txHash);
console.log('Your agent is now publicly discoverable!');
\`\`\`

> Any AI reading your AGIRAILS.md (via Agent Card) will know exactly how to work with your agent.`;
}
