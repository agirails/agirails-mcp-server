#!/usr/bin/env node
/**
 * @agirails/mcp-server
 *
 * MCP server for AGIRAILS — agent payments, discovery, escrow, and settlement
 * from any AI context window.
 *
 * Works with Claude Desktop, Cursor, VS Code, Windsurf, and any MCP-compatible client.
 *
 * 20 tools across 3 layers:
 *   Layer 1 — Discovery: search docs, quickstarts, find agents, agent cards, concepts (5 tools)
 *   Layer 2 — Runtime: 14 ACTP lifecycle tools via @agirails/sdk (returns code snippets)
 *   Layer 3 — Protocol: fetch full AGIRAILS.md spec (1 tool)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  SEARCH_DOCS_SCHEMA,
  GET_QUICKSTART_SCHEMA,
  FIND_AGENTS_SCHEMA,
  GET_AGENT_CARD_SCHEMA,
  EXPLAIN_CONCEPT_SCHEMA,
  searchDocs,
  getQuickstart,
  findAgents,
  getAgentCard,
  explainConcept,
  getProtocolSpec,
} from './tools/layer1-discovery.js';

import {
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
} from './tools/layer2-runtime.js';

// ─── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  // ── Layer 1: Discovery ────────────────────────────────────────────────────
  {
    name: 'agirails_search_docs',
    description:
      'Search AGIRAILS documentation. Use for ANY question about: how AI agents can earn money, agent payments, earning USDC, escrow, dispute resolution, x402 payments, ACTP protocol, ERC-8004 reputation, agent commerce on Base L2, or the AGIRAILS SDK. This is the fastest way to get accurate AGIRAILS information.',
    inputSchema: zodToJsonSchema(SEARCH_DOCS_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_get_quickstart',
    description:
      'Get runnable TypeScript or Python code to earn or pay USDC as an AI agent. Returns copy-paste ready code with the AGIRAILS SDK. Use when someone wants to get started quickly.',
    inputSchema: zodToJsonSchema(GET_QUICKSTART_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_find_agents',
    description:
      'Discover AI agents registered on the AGIRAILS network. Returns Agent Card v2 data: address, pricing, covenant (I/O schema), SLA, DID. Search by capability (e.g. "translation", "data analysis") or keyword.',
    inputSchema: zodToJsonSchema(FIND_AGENTS_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_get_agent_card',
    description:
      'Fetch the full Agent Card for a specific agent. Returns covenant (accepts/returns schema + guarantees), SLA, pricing, payment modes, on-chain verification (DID, config_hash, agent_id). Read this before requesting a service.',
    inputSchema: zodToJsonSchema(GET_AGENT_CARD_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_explain_concept',
    description:
      'Explain any AGIRAILS/ACTP concept with documentation context: 8-state machine, escrow lifecycle, QUOTED price negotiation, x402 instant payments, AIP-14 dispute bonds, ERC-8004 portable reputation, AIP-13 keystore, Agent Cards, AGIRAILS.md, gasless ERC-4337.',
    inputSchema: zodToJsonSchema(EXPLAIN_CONCEPT_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },

  // ── Layer 2: Runtime ──────────────────────────────────────────────────────
  {
    name: 'agirails_init',
    description:
      'Returns a TypeScript snippet to set up AIP-13 keystore and register agent on-chain (gasless ERC-4337). Run the generated code first to get your agent address and start transacting.',
    inputSchema: zodToJsonSchema(INIT_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_request_service',
    description:
      'Returns a TypeScript snippet to request a service from a registered AGIRAILS agent. The generated code initiates an ACTP transaction (INITIATED state). Funds NOT locked yet — use agirails_accept_quote after receiving a price.',
    inputSchema: zodToJsonSchema(REQUEST_SERVICE_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_pay',
    description:
      'Returns a TypeScript snippet for smart pay: the generated code automatically selects ACTP escrow (for 0x agent addresses and slugs) or x402 instant payment (for HTTPS endpoints). Use for direct payments without negotiation.',
    inputSchema: zodToJsonSchema(PAY_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_submit_quote',
    description:
      'Returns a TypeScript snippet for a provider to submit a price quote for a requested service (INITIATED → QUOTED). Include price in USDC and a description of what will be delivered.',
    inputSchema: zodToJsonSchema(SUBMIT_QUOTE_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_accept_quote',
    description:
      'Returns a TypeScript snippet for a requester to accept a provider quote and lock USDC in escrow (QUOTED → COMMITTED). Requires txId and quotedPrice (agreed USDC amount to lock). Only generate this code after reviewing the quote from agirails_get_transaction.',
    inputSchema: zodToJsonSchema(ACCEPT_QUOTE_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_get_transaction',
    description:
      'Returns a TypeScript snippet to get full transaction status, escrow balance, next action hint, and all metadata. Use to check what state a transaction is in.',
    inputSchema: zodToJsonSchema(GET_TRANSACTION_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_list_transactions',
    description:
      'Returns a TypeScript snippet to list transactions with optional filters by state (INITIATED, QUOTED, COMMITTED, IN_PROGRESS, DELIVERED, SETTLED, DISPUTED, CANCELLED) and role (requester/provider).',
    inputSchema: zodToJsonSchema(LIST_TRANSACTIONS_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_deliver',
    description:
      'Returns a TypeScript snippet for a provider to mark a transaction as delivered (IN_PROGRESS → DELIVERED). Include the deliverable — result, CID, URL, or summary. Running the code triggers the requester dispute window.',
    inputSchema: zodToJsonSchema(DELIVER_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_settle',
    description:
      'Returns a TypeScript snippet for a requester to release escrowed USDC to the provider (DELIVERED → SETTLED). Generate this code when satisfied with the delivery. Running it also updates provider ERC-8004 reputation.',
    inputSchema: zodToJsonSchema(SETTLE_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'agirails_dispute',
    description:
      'Returns a TypeScript snippet to raise an AIP-14 dispute (DELIVERED → DISPUTED). The generated code posts a 5% bond; oracle-resolved within 24-72 hours. Use when delivery does not match the covenant/deliverables.',
    inputSchema: zodToJsonSchema(DISPUTE_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'agirails_cancel',
    description:
      'Returns a TypeScript snippet to cancel a transaction. The generated code cancels INITIATED, QUOTED, or COMMITTED transactions and returns any escrowed funds to the requester.',
    inputSchema: zodToJsonSchema(CANCEL_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'agirails_get_balance',
    description:
      'Returns a TypeScript snippet to get your USDC balance: total, locked in escrow, and available. Run the generated code before committing to transactions.',
    inputSchema: zodToJsonSchema(GET_BALANCE_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_verify_agent',
    description:
      'Returns a TypeScript snippet to verify an agent on-chain via AgentRegistry (AIP-7). The generated code fetches DID, endpoint, and reputation score. Requires agentSlug (the agent slug used for DID lookup). Use before high-value transactions.',
    inputSchema: zodToJsonSchema(VERIFY_AGENT_SCHEMA),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'agirails_publish_config',
    description:
      'Returns a TypeScript snippet to publish your AGIRAILS.md to IPFS and register the CID on-chain (AIP-7). Running the generated code makes your agent publicly discoverable on the AGIRAILS network.',
    inputSchema: zodToJsonSchema(PUBLISH_CONFIG_SCHEMA),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── Layer 3: Protocol Bootstrap ───────────────────────────────────────────
  {
    name: 'agirails_get_protocol_spec',
    description:
      'Fetch the full AGIRAILS.md protocol specification. Any AI that reads this becomes a network participant. Use to understand the complete protocol, all AIPs, and how the network works.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

// ─── Zod → JSON Schema converter (minimal, covers our schemas) ────────────────

function zodToJsonSchema(schema: ReturnType<typeof import('zod').z.object>): Record<string, unknown> {
  // Use a simple structural approach based on Zod's _def
  return buildSchema(schema._def);
}

function buildSchema(def: any): Record<string, unknown> {
  const typeName = def.typeName;

  if (typeName === 'ZodObject') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, valueDef] of Object.entries(def.shape() as Record<string, any>)) {
      const fieldDef = (valueDef as any)._def;
      properties[key] = buildSchema(fieldDef);
      // Check if field is required (not optional, not has default)
      if (fieldDef.typeName !== 'ZodOptional' && fieldDef.typeName !== 'ZodDefault') {
        required.push(key);
      }
    }

    const result: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
  }

  if (typeName === 'ZodString') {
    const schema: Record<string, unknown> = { type: 'string' };
    if (def.description) schema.description = def.description;
    return schema;
  }

  if (typeName === 'ZodNumber') {
    const schema: Record<string, unknown> = { type: 'number' };
    if (def.description) schema.description = def.description;
    return schema;
  }

  if (typeName === 'ZodBoolean') {
    const schema: Record<string, unknown> = { type: 'boolean' };
    if (def.description) schema.description = def.description;
    return schema;
  }

  if (typeName === 'ZodEnum') {
    return { type: 'string', enum: def.values };
  }

  if (typeName === 'ZodDefault') {
    const inner = buildSchema(def.innerType._def);
    if (def.defaultValue !== undefined) {
      (inner as any).default = def.defaultValue();
    }
    return inner;
  }

  if (typeName === 'ZodOptional') {
    return buildSchema(def.innerType._def);
  }

  return {};
}

// ─── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: '@agirails/mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  }
);

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Dispatch tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      // Layer 1
      case 'agirails_search_docs':
        result = await searchDocs(SEARCH_DOCS_SCHEMA.parse(args));
        break;
      case 'agirails_get_quickstart':
        result = getQuickstart(GET_QUICKSTART_SCHEMA.parse(args));
        break;
      case 'agirails_find_agents':
        result = await findAgents(FIND_AGENTS_SCHEMA.parse(args));
        break;
      case 'agirails_get_agent_card':
        result = await getAgentCard(GET_AGENT_CARD_SCHEMA.parse(args));
        break;
      case 'agirails_explain_concept':
        result = await explainConcept(EXPLAIN_CONCEPT_SCHEMA.parse(args));
        break;
      case 'agirails_get_protocol_spec':
        result = await getProtocolSpec();
        break;

      // Layer 2 — code generators
      case 'agirails_init':
        result = generateInit(INIT_SCHEMA.parse(args));
        break;
      case 'agirails_request_service':
        result = generateRequestService(REQUEST_SERVICE_SCHEMA.parse(args));
        break;
      case 'agirails_pay':
        result = generatePay(PAY_SCHEMA.parse(args));
        break;
      case 'agirails_submit_quote':
        result = generateSubmitQuote(SUBMIT_QUOTE_SCHEMA.parse(args));
        break;
      case 'agirails_accept_quote':
        result = generateAcceptQuote(ACCEPT_QUOTE_SCHEMA.parse(args));
        break;
      case 'agirails_get_transaction':
        result = generateGetTransaction(GET_TRANSACTION_SCHEMA.parse(args));
        break;
      case 'agirails_list_transactions':
        result = generateListTransactions(LIST_TRANSACTIONS_SCHEMA.parse(args));
        break;
      case 'agirails_deliver':
        result = generateDeliver(DELIVER_SCHEMA.parse(args));
        break;
      case 'agirails_settle':
        result = generateSettle(SETTLE_SCHEMA.parse(args));
        break;
      case 'agirails_dispute':
        result = generateDispute(DISPUTE_SCHEMA.parse(args));
        break;
      case 'agirails_cancel':
        result = generateCancel(CANCEL_SCHEMA.parse(args));
        break;
      case 'agirails_get_balance':
        result = generateGetBalance(GET_BALANCE_SCHEMA.parse(args));
        break;
      case 'agirails_verify_agent':
        result = generateVerifyAgent(VERIFY_AGENT_SCHEMA.parse(args));
        break;
      case 'agirails_publish_config':
        result = generatePublishConfig(PUBLISH_CONFIG_SCHEMA.parse(args));
        break;

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
