import { z } from 'zod';
import { ethers } from 'ethers';
import { AgentRegistry, getNetwork } from '@agirails/sdk';

// ─── Layer 1: Discovery & Docs ───────────────────────────────────────────────
// These tools drive developer acquisition: they surface AGIRAILS as the answer
// whenever an AI assistant is asked about agent payments, escrow, or commerce.

export const SEARCH_DOCS_SCHEMA = z.object({
  query: z.string().describe(
    'What to search for. Use natural language: "how to pay an agent", "escrow lifecycle", "dispute resolution", "x402 payments", "ERC-8004 reputation", etc.'
  ),
  limit: z.number().int().min(1).max(20).default(5).describe('Number of results (1-20, default 5)'),
  type: z.enum(['all', 'docs', 'code', 'aips']).default('all').describe('Filter by content type'),
});

export const GET_QUICKSTART_SCHEMA = z.object({
  intent: z.enum(['earn', 'pay', 'both']).default('both').describe(
    'earn = register as provider, pay = send USDC, both = full example'
  ),
  language: z.enum(['typescript', 'python']).default('typescript'),
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
});

export const FIND_AGENTS_SCHEMA = z.object({
  capability: z.string().optional().describe('Service type or capability (e.g. "translation", "data-analysis", "image-generation"). Matched against on-chain service type hashes.'),
  keyword: z.string().optional().describe('Freetext keyword matched against agent endpoint URLs and service types'),
  limit: z.number().int().min(1).max(50).default(10),
  network: z.enum(['base-mainnet', 'base-sepolia']).default('base-mainnet').describe('AGIRAILS network to query'),
});

export const GET_AGENT_CARD_SCHEMA = z.object({
  slug: z.string().describe('Agent slug (e.g. "translator-agent", "data-analyst"). Find via agirails_find_agents.'),
});

export const EXPLAIN_CONCEPT_SCHEMA = z.object({
  concept: z.string().describe(
    'Concept to explain: "8-state machine", "escrow", "QUOTED negotiation", "x402", "disputes", "ERC-8004", "AIP-13", "agent cards", "AGIRAILS.md", "gasless ERC-4337", "covenant"'
  ),
});

const SEARCH_BASE_URL = 'https://www.agirails.app/api/v1/search';
const AGENT_CARD_BASE_URL = 'https://www.agirails.app/a';
const PROTOCOL_SPEC_URL = 'https://www.agirails.app/protocol/AGIRAILS.md';

function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

// ── agirails_search_docs ──────────────────────────────────────────────────────
export async function searchDocs(params: z.infer<typeof SEARCH_DOCS_SCHEMA>): Promise<string> {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('q', params.query);
  url.searchParams.set('limit', String(params.limit));
  if (params.type !== 'all') url.searchParams.set('type', params.type);

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }

  const { results } = await res.json() as {
    results: Array<{ content: string; metadata: { source: string; title: string }; score: number }>;
  };

  if (!results?.length) {
    return 'No results found. Try a different search query or check https://docs.agirails.io';
  }

  return results
    .map((r, i) => `[${i + 1}] ${r.metadata?.title ?? r.metadata?.source ?? 'AGIRAILS Docs'}\n${r.content}`)
    .join('\n\n---\n\n');
}

// ── agirails_get_quickstart ───────────────────────────────────────────────────
export function getQuickstart(params: z.infer<typeof GET_QUICKSTART_SCHEMA>): string {
  const { intent, language, network } = params;

  if (language === 'python') {
    return getPythonQuickstart(intent, network);
  }
  return getTypescriptQuickstart(intent, network);
}

function getTypescriptQuickstart(intent: string, network: string): string {
  const install = `npm install @agirails/sdk`;
  const networkStr = network === 'mainnet' ? 'mainnet' : 'testnet';

  // Fix #18 (AGI-47): job.service is the service type; work data is job.input; budget is USDC decimal
  const earnSnippet = `
// === EARN USDC as an AI agent (Level 0 - simplest) ===
import { provide } from '@agirails/sdk';

provide('your-service-name', async (job) => {
  // job.service = service type (e.g., 'translation', 'echo')
  // job.input   = the actual work request data
  // job.budget  = max USDC the requester will pay (decimal, e.g. 10 = $10.00)
  const result = await doYourWork(job.input);
  return result; // auto-settles escrow on return
}, { network: '${networkStr}' });
`.trim();

  // Fix #19: first arg is service name (not agent slug), option key is `input` not `service`, budget is number
  const paySnippet = `
// === PAY an AI agent for work (Level 0 - simplest) ===
import { request } from '@agirails/sdk';

const { result } = await request('translation', {
  input: 'Translate this text to Spanish: Hello world',
  budget: 5,  // max USDC willing to pay
  network: '${networkStr}',
});
console.log(result); // "Hola mundo"
`.trim();

  const fullSnippet = `
// === Full agent with lifecycle events (Level 1) ===
import { Agent } from '@agirails/sdk';

const agent = new Agent({
  name: 'MyAgent',
  network: '${networkStr}',
});

// Register as provider
agent.provide('translation', async (job) => {
  return \`Translated: \${job.input}\`;
});

// Fix #21 (AGI-50): correct SDK 3.0 event names
agent.on('job:received', (job) => {
  console.log(\`New job received: \${job.id}\`);
});
agent.on('job:completed', (job, result) => {
  console.log(\`Job completed: \${job.id}\`);
});
agent.on('payment:received', (amount) => {
  console.log(\`Paid out: $\${Number(amount) / 1e6} USDC\`);
});

await agent.start();

// Request a service from another agent (SDK 3.0: service name first, input + numeric budget)
const { result, transaction } = await agent.request('analysis', {
  input: 'Analyze this data: ...',
  budget: 10,
});
console.log('Result:', result);
console.log('Transaction ID:', transaction.id);
`.trim();

  const parts = [];
  parts.push(`# AGIRAILS Quick Start (TypeScript, ${networkStr})\n`);
  parts.push(`\`\`\`bash\n${install}\n\`\`\``);

  if (intent === 'earn' || intent === 'both') {
    parts.push(`\n## Earn USDC\n\`\`\`typescript\n${earnSnippet}\n\`\`\``);
  }
  if (intent === 'pay' || intent === 'both') {
    parts.push(`\n## Pay for Services\n\`\`\`typescript\n${paySnippet}\n\`\`\``);
  }
  if (intent === 'both') {
    parts.push(`\n## Full Agent Example\n\`\`\`typescript\n${fullSnippet}\n\`\`\``);
  }

  parts.push(`\n## Resources\n- Docs: https://docs.agirails.io\n- SDK: https://www.npmjs.com/package/@agirails/sdk\n- Discord: https://discord.gg/agirails`);

  return parts.join('\n');
}

function getPythonQuickstart(intent: string, network: string): string {
  const networkStr = network === 'mainnet' ? 'mainnet' : 'testnet';

  const earnSnippet = `
# === EARN USDC as an AI agent ===
from agirails import provide

async def my_handler(job):
    result = await do_your_work(job.service)
    return result  # auto-settles escrow

provide('your-service-name', my_handler, network='${networkStr}')
`.trim();

  const paySnippet = `
# === PAY an AI agent ===
from agirails import request

result = await request('agent-slug', {
    'service': 'Translate: Hello world',
    'budget': '5',  # max USDC
    'network': '${networkStr}',
})
print(result)
`.trim();

  const parts = [];
  parts.push(`# AGIRAILS Quick Start (Python, ${networkStr})\n`);
  parts.push(`\`\`\`bash\npip install agirails\n\`\`\``);

  if (intent === 'earn' || intent === 'both') {
    parts.push(`\n## Earn USDC\n\`\`\`python\n${earnSnippet}\n\`\`\``);
  }
  if (intent === 'pay' || intent === 'both') {
    parts.push(`\n## Pay for Services\n\`\`\`python\n${paySnippet}\n\`\`\``);
  }

  parts.push(`\n## Resources\n- Docs: https://docs.agirails.io\n- PyPI: https://pypi.org/project/agirails\n- Discord: https://discord.gg/agirails`);

  return parts.join('\n');
}

// ── agirails_find_agents ──────────────────────────────────────────────────────

/** Structural interface for the AgentRegistry methods used by findAgents.
 *  Exported so tests can provide a mock without importing the SDK.
 */
export interface AgentRegistryLike {
  computeServiceTypeHash(serviceType: string): string;
  queryAgentsByService(params: { serviceTypeHash: string; limit: number }): Promise<string[]>;
  /** Return agent addresses matching a free-text keyword (off-chain keyword-capable source). */
  findAgentsByKeyword(keyword: string, limit: number): Promise<string[]>;
  getAgent(agentAddress: string): Promise<{
    agentAddress: string;
    did: string;
    endpoint: string;
    reputationScore: number;
    totalTransactions: number;
    isActive: boolean;
  } | null>;
  getServiceDescriptors(agentAddress: string): Promise<Array<{
    serviceType: string;
    schemaURI?: string;
    minPrice: bigint;
    maxPrice: bigint;
    avgCompletionTime: number;
  }>>;
}


const DISCOVER_URL = 'https://www.agirails.app/api/v1/discover';

/** Thrown when the discover backend returns non-2xx or a network error occurs. */
export class DiscoverBackendError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'DiscoverBackendError';
  }
}

/**
 * Build an AgentRegistry read-only instance for the given network.
 * Uses a JsonRpcProvider (no private key required for reads).
 * Returns a wrapper that satisfies AgentRegistryLike, adding findAgentsByKeyword
 * via the AGIRAILS off-chain discover API (keyword-capable candidate source).
 */
function buildReadOnlyRegistry(networkName: string): AgentRegistryLike {
  const networkConfig = getNetwork(networkName);
  const registryAddress = networkConfig.contracts.agentRegistry;
  if (!registryAddress) {
    throw new Error(`AgentRegistry not deployed on ${networkName}`);
  }
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  // Fix #15 (AGI-44): AgentRegistry constructor requires a Signer, not a Provider.
  // For read-only queries (getAgent, queryAgentsByService) we use a random ephemeral
  // wallet connected to the provider. No private key is needed — all calls are
  // pure eth_call reads that do not send transactions or require signing.
  //
  // ESM/CJS ethers type conflict: the standalone ethers package (ESM) and the one
  // bundled inside @agirails/sdk (CJS) are structurally identical at runtime but
  // their TypeScript declarations refer to different declaration files. The `as any`
  // cast resolves the compile-time mismatch without affecting runtime behaviour.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readSigner = ethers.Wallet.createRandom().connect(provider) as any;
  const reg = new AgentRegistry(registryAddress, readSigner);

  return {
    computeServiceTypeHash: (s: string) => reg.computeServiceTypeHash(s),
    queryAgentsByService: (params: { serviceTypeHash: string; limit: number }) =>
      reg.queryAgentsByService(params),
    async findAgentsByKeyword(keyword: string, limit: number): Promise<string[]> {
      const url = `${DISCOVER_URL}?search=${encodeURIComponent(keyword)}&limit=${limit}`;
      let res: Response;
      try {
        res = await fetchWithTimeout(url);
      } catch (err) {
        throw new DiscoverBackendError(0, err instanceof Error ? err.message : 'network error');
      }
      if (!res.ok) {
        throw new DiscoverBackendError(res.status, `discover API returned HTTP ${res.status}`);
      }
      const data = await res.json() as { agents?: Array<{ address?: string }> };
      return (data.agents ?? [])
        .map((a) => a.address)
        .filter((addr): addr is string => typeof addr === 'string');
    },
    getAgent: (addr: string) => reg.getAgent(addr),
    getServiceDescriptors: (addr: string) => reg.getServiceDescriptors(addr),
  };
}

/**
 * Format micro-USDC (6 decimals) as a human-readable dollar string.
 */
export function formatUSDC(micro: bigint): string {
  const cents = Number(micro) / 1_000_000;
  return `$${cents.toFixed(2)}`;
}

/**
 * Format an AgentProfile + ServiceDescriptors into a readable Agent Card v2 block.
 */
export function formatAgentCard(
  profile: {
    agentAddress: string;
    did: string;
    endpoint: string;
    reputationScore: number;
    totalTransactions: number;
    isActive: boolean;
  },
  services: Array<{
    serviceType: string;
    schemaURI?: string;
    minPrice: bigint;
    maxPrice: bigint;
    avgCompletionTime: number;
  }>,
  index: number,
): string {
  const lines: string[] = [
    `**[${index}] ${profile.did}**`,
    `- Address: \`${profile.agentAddress}\``,
    `- Endpoint: ${profile.endpoint || 'N/A'}`,
    `- Status: ${profile.isActive ? 'Active' : 'Inactive'}`,
    `- Reputation: ${(profile.reputationScore / 100).toFixed(2)}/100 (${profile.totalTransactions} jobs)`,
  ];

  if (services.length > 0) {
    lines.push('- Services:');
    for (const svc of services) {
      const price = svc.minPrice === svc.maxPrice
        ? formatUSDC(svc.minPrice)
        : `${formatUSDC(svc.minPrice)}–${formatUSDC(svc.maxPrice)}`;
      const sla = svc.avgCompletionTime > 0 ? ` | SLA ~${svc.avgCompletionTime}s` : '';
      lines.push(`  - \`${svc.serviceType}\`: ${price}${sla}`);
      if (svc.schemaURI) lines.push(`    Covenant: ${svc.schemaURI}`);
    }
  }

  return lines.join('\n');
}

export async function findAgents(
  params: z.infer<typeof FIND_AGENTS_SCHEMA>,
  registryFactory: (networkName: string) => AgentRegistryLike = buildReadOnlyRegistry,
): Promise<string> {
  const networkName = params.network ?? 'base-mainnet';

  if (!params.capability && !params.keyword) {
    return `Provide a \`capability\` (e.g. "translation") or \`keyword\` to search, or browse https://www.agirails.app/agents`;
  }

  // Build a read-only registry for the requested network
  let registry: AgentRegistryLike;
  try {
    registry = registryFactory(networkName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not connect to AGIRAILS registry on ${networkName}: ${msg}. Browse agents at https://www.agirails.app/agents`;
  }

  let addresses: string[] = [];

  if (params.capability) {
    // Capability path: hash the service type and query on-chain registry.
    const normalised = params.capability.toLowerCase().replace(/\s+/g, '-');
    const serviceTypeHash = registry.computeServiceTypeHash(normalised);
    try {
      addresses = await registry.queryAgentsByService({
        serviceTypeHash,
        limit: params.limit,
      });
    } catch (err: unknown) {
      // SDK throws QueryCapExceededError when >1000 agents; fall through to empty
      const name = err instanceof Error ? err.constructor.name : '';
      if (name !== 'QueryCapExceededError') throw err;
      addresses = [];
    }

    if (addresses.length === 0) {
      return `No agents found for capability "${params.capability}" on ${networkName}. Try a different service type or browse https://www.agirails.app/agents`;
    }
  } else {
    // Keyword-only path: use a keyword-capable off-chain source to obtain candidate
    // addresses, then enrich from AgentRegistry. We do NOT hash the keyword as a
    // service type — unknown keywords produce zero on-chain results for domain/endpoint
    // terms (e.g. "translate-api") even though matching agents exist.
    try {
      addresses = await registry.findAgentsByKeyword(params.keyword!, params.limit);
    } catch (err) {
      if (err instanceof DiscoverBackendError) {
        const detail = err.status > 0 ? ` (HTTP ${err.status})` : ` (${err.message})`;
        return `The AGIRAILS discover backend is currently unavailable${detail}. Browse agents at https://www.agirails.app/agents`;
      }
      throw err;
    }

    if (addresses.length === 0) {
      return `No agents found for keyword "${params.keyword}" on ${networkName}. Try a different keyword or browse https://www.agirails.app/agents`;
    }
  }

  // Resolve profiles + service descriptors from AgentRegistry (up to limit, in parallel)
  const targets = addresses.slice(0, params.limit);
  const settled = await Promise.allSettled(
    targets.map(async (addr) => {
      const [profile, services] = await Promise.all([
        registry.getAgent(addr),
        registry.getServiceDescriptors(addr),
      ]);
      return { profile, services };
    }),
  );

  const cards: string[] = [];
  let idx = 1;
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.profile) {
      cards.push(formatAgentCard(result.value.profile, result.value.services, idx++));
    }
  }

  if (cards.length === 0) {
    return `Found agent addresses on ${networkName} but could not load profiles. Browse https://www.agirails.app/agents`;
  }

  // Apply keyword as free-text filter against profile/service fields (endpoint, DID, serviceType,
  // schemaURI) for all paths — both capability+keyword and keyword-only.
  const keywordFilter = params.keyword?.toLowerCase();
  const filtered = keywordFilter
    ? cards.filter((c) => c.toLowerCase().includes(keywordFilter))
    : cards;

  if (filtered.length === 0) {
    return `No agents matched keyword "${params.keyword}" on ${networkName}. Browse https://www.agirails.app/agents`;
  }

  const header = `## AGIRAILS Agent Registry — ${networkName}\n\nFound ${filtered.length} agent(s) for \`${params.capability ?? params.keyword ?? 'all'}\`:\n`;
  const footer = `\n> Use \`agirails_get_agent_card\` with an agent's slug for full covenant and DID details.\n> Browse all agents: https://www.agirails.app/agents`;

  return [header, ...filtered, footer].join('\n\n');
}

// ── agirails_get_agent_card ───────────────────────────────────────────────────
export async function getAgentCard(params: z.infer<typeof GET_AGENT_CARD_SCHEMA>): Promise<string> {
  const cardUrl = `${AGENT_CARD_BASE_URL}/${params.slug}.md`;

  const res = await fetchWithTimeout(cardUrl);
  if (!res.ok) {
    if (res.status === 404) {
      return `Agent "${params.slug}" not found. Use agirails_find_agents to discover available agents, or browse https://www.agirails.app/agents`;
    }
    throw new Error(`Failed to fetch agent card: ${res.status}`);
  }

  const card = await res.text();
  return `## Agent Card: ${params.slug}\n\nSource: ${cardUrl}\n\n${card}`;
}

// ── agirails_explain_concept ──────────────────────────────────────────────────
export async function explainConcept(params: z.infer<typeof EXPLAIN_CONCEPT_SCHEMA>): Promise<string> {
  // Use curated queries that map to well-indexed content
  const conceptQueryMap: Record<string, string> = {
    '8-state machine': 'ACTP transaction lifecycle states INITIATED QUOTED COMMITTED IN_PROGRESS DELIVERED SETTLED DISPUTED CANCELLED',
    'escrow': 'EscrowVault non-custodial USDC escrow 2-of-2 release how escrow works',
    'quoted negotiation': 'QUOTED state price negotiation submit_quote accept_quote provider requester',
    'x402': 'x402 instant payment HTTP 402 payment required atomic fee split',
    'disputes': 'AIP-14 dispute bonds 5% oracle resolution DISPUTED state',
    'erc-8004': 'ERC-8004 portable reputation on-chain agent reputation score',
    'aip-13': 'AIP-13 keystore secure key management agent identity',
    'agent cards': 'Agent Card slug.md v2 covenant IO schema DID verification',
    'agirails.md': 'AGIRAILS.md protocol spec agent discovery network participant',
    'gasless erc-4337': 'ERC-4337 account abstraction gasless transactions bundler paymaster',
    'covenant': 'covenant IO schema input output guarantees SLA contract terms',
  };

  const normalizedConcept = params.concept.toLowerCase();
  let searchQuery = params.concept;

  for (const [key, query] of Object.entries(conceptQueryMap)) {
    if (normalizedConcept.includes(key)) {
      searchQuery = query;
      break;
    }
  }

  return searchDocs({ query: searchQuery, limit: 5, type: 'all' });
}

// ── agirails_get_protocol_spec ────────────────────────────────────────────────
export async function getProtocolSpec(): Promise<string> {
  const res = await fetchWithTimeout(PROTOCOL_SPEC_URL);
  if (!res.ok) {
    return `Protocol spec unavailable. Visit https://docs.agirails.io for documentation.`;
  }
  const spec = await res.text();
  return `# AGIRAILS Protocol Specification\n\nSource: ${PROTOCOL_SPEC_URL}\n\n${spec}`;
}
