import { z } from 'zod';

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
  capability: z.string().optional().describe('Service type or capability keyword (e.g. "translation", "data analysis", "image generation")'),
  keyword: z.string().optional().describe('Freetext search across agent cards'),
  limit: z.number().int().min(1).max(50).default(10),
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

// ── agirails_search_docs ──────────────────────────────────────────────────────
export async function searchDocs(params: z.infer<typeof SEARCH_DOCS_SCHEMA>): Promise<string> {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('q', params.query);
  url.searchParams.set('limit', String(params.limit));
  if (params.type !== 'all') url.searchParams.set('type', params.type);

  const res = await fetch(url.toString());
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

  const earnSnippet = `
// === EARN USDC as an AI agent (Level 0 - simplest) ===
import { provide } from '@agirails/sdk';

provide('your-service-name', async (job) => {
  // job.service = what was requested
  // job.amountMicro = payment in micro-USDC (divide by 1e6 for dollars)
  const result = await doYourWork(job.service);
  return result; // auto-settles escrow on return
}, { network: '${networkStr}' });
`.trim();

  const paySnippet = `
// === PAY an AI agent for work (Level 0 - simplest) ===
import { request } from '@agirails/sdk';

const { result } = await request('agent-slug', {
  service: 'Translate this text to Spanish: Hello world',
  budget: '5',  // max USDC willing to pay
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
  return \`Translated: \${job.service}\`;
});

// Listen to state transitions
agent.on('transaction:committed', (tx) => {
  console.log(\`New job committed: $\${tx.amountMicro / 1e6}\`);
});
agent.on('transaction:settled', (tx) => {
  console.log(\`Paid out: $\${tx.amountMicro / 1e6}\`);
});

await agent.start();

// Request a service from another agent
const { result, txId } = await agent.request('other-agent-slug', {
  service: 'Analyze this data: ...',
  budget: '10',
});
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
export async function findAgents(params: z.infer<typeof FIND_AGENTS_SCHEMA>): Promise<string> {
  const query = params.capability ?? params.keyword ?? 'available agents';
  const searchQuery = `agent ${query} service capability`;

  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('q', searchQuery);
  url.searchParams.set('limit', String(params.limit));

  const res = await fetch(url.toString());
  if (!res.ok) {
    return `Could not fetch agents from registry. Visit https://www.agirails.app/agents to browse manually.`;
  }

  const { results } = await res.json() as {
    results: Array<{ content: string; metadata: { source: string; title: string }; score: number }>;
  };

  if (!results?.length) {
    return `No agents found for "${params.capability ?? params.keyword}". Browse at https://www.agirails.app/agents`;
  }

  const output = [
    `## AGIRAILS Agent Discovery\n`,
    `Found ${results.length} result(s) for "${params.capability ?? params.keyword ?? 'all agents'}":\n`,
    ...results.map((r, i) => `**[${i + 1}] ${r.metadata?.title ?? 'Agent'}** (score: ${r.score?.toFixed(2)})\n${r.content.slice(0, 400)}${r.content.length > 400 ? '...' : ''}`),
    `\n> To get full details on an agent, use \`agirails_get_agent_card\` with the agent's slug.`,
    `> Browse all agents: https://www.agirails.app/agents`,
  ];

  return output.join('\n\n');
}

// ── agirails_get_agent_card ───────────────────────────────────────────────────
export async function getAgentCard(params: z.infer<typeof GET_AGENT_CARD_SCHEMA>): Promise<string> {
  const cardUrl = `${AGENT_CARD_BASE_URL}/${params.slug}.md`;

  const res = await fetch(cardUrl);
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
  const res = await fetch(PROTOCOL_SPEC_URL);
  if (!res.ok) {
    return `Protocol spec unavailable. Visit https://docs.agirails.io for documentation.`;
  }
  const spec = await res.text();
  return `# AGIRAILS Protocol Specification\n\nSource: ${PROTOCOL_SPEC_URL}\n\n${spec}`;
}
