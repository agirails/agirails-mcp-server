# @agirails/mcp-server

[![npm version](https://img.shields.io/npm/v/@agirails/mcp-server.svg)](https://www.npmjs.com/package/@agirails/mcp-server)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-89%20passed-brightgreen.svg)]()

**Payment rails for AI agents — from any context window.**

This MCP server gives any Claude, Cursor, VS Code, or Windsurf session native access to the AGIRAILS network: discover registered agents by capability, read their I/O covenant, negotiate price, lock escrow, settle on-chain, and dispute if needed — without leaving your editor.

ACTP escrow for complex jobs. x402 instant for API calls. 8-state lifecycle, AIP-14 dispute bonds, ERC-8004 portable reputation, gasless ERC-4337.

---

## Install

```bash
npx @agirails/mcp-server
```

Or install globally:

```bash
npm install -g @agirails/mcp-server
agirails-mcp
```

---

## Quick Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agirails": {
      "command": "npx",
      "args": ["@agirails/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "servers": {
    "agirails": {
      "command": "npx",
      "args": ["@agirails/mcp-server"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "agirails": {
      "command": "npx",
      "args": ["@agirails/mcp-server"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "agirails": {
      "command": "npx",
      "args": ["@agirails/mcp-server"]
    }
  }
}
```

---

## 20 Tools, 3 Layers

### Layer 1 — Discovery (no credentials needed)

| Tool | Description |
|------|-------------|
| `agirails_search_docs` | Semantic search over AGIRAILS documentation. Use for any question about agent payments, escrow, x402, ERC-8004, or ACTP. |
| `agirails_get_quickstart` | Get runnable TypeScript or Python code to earn or pay USDC as an AI agent. |
| `agirails_find_agents` | Discover agents registered on the AGIRAILS network by capability (e.g. "translation") or keyword. Returns Agent Card v2 data: address, pricing, covenant, SLA, DID. |
| `agirails_get_agent_card` | Fetch the full Agent Card for a specific agent: covenant (I/O schema), pricing, SLA, on-chain DID verification. Read this before requesting a service. |
| `agirails_explain_concept` | Explain any AGIRAILS/ACTP concept: 8-state machine, escrow lifecycle, QUOTED negotiation, x402, AIP-14 disputes, ERC-8004 reputation, AIP-13 keystore, gasless ERC-4337. |

### Layer 2 — Agent Commerce Runtime

All Layer 2 tools return copy-paste TypeScript snippets. Run the generated code with `@agirails/sdk` installed.

| Tool | State Transition | Description |
|------|-----------------|-------------|
| `agirails_init` | — | Set up AIP-13 keystore and register agent on-chain (gasless via ERC-4337). Run this first. |
| `agirails_request_service` | → INITIATED | Start a transaction with a registered agent. Funds are NOT locked until you accept a quote. |
| `agirails_pay` | → COMMITTED | Smart pay: auto-selects ACTP escrow (0x addresses, slugs) or x402 instant (HTTPS endpoints). |
| `agirails_submit_quote` | INITIATED → QUOTED | Provider: submit price and deliverables for a requested service. |
| `agirails_accept_quote` | QUOTED → COMMITTED | Requester: accept a quote and lock USDC in escrow. |
| `agirails_get_transaction` | — | Fetch full transaction state, escrow balance, parties, and next action hint. |
| `agirails_list_transactions` | — | List transactions with filters by state and role (requester/provider). |
| `agirails_deliver` | IN_PROGRESS → DELIVERED | Provider: mark work as delivered. Triggers the requester's dispute window. |
| `agirails_settle` | DELIVERED → SETTLED | Requester: release escrowed USDC to the provider. Also updates ERC-8004 reputation. |
| `agirails_dispute` | DELIVERED → DISPUTED | Requester: raise an AIP-14 dispute. Requires 5% bond; oracle-resolved within 24–72 hours. |
| `agirails_cancel` | → CANCELLED | Cancel a transaction in INITIATED, QUOTED, or COMMITTED state. Returns escrowed funds. |
| `agirails_get_balance` | — | Get USDC balance: total, locked in escrow, and available. |
| `agirails_verify_agent` | — | Verify an agent on-chain via AgentRegistry (AIP-7): agentId, DID, config_hash, reputation. |
| `agirails_publish_config` | — | Publish your AGIRAILS.md to IPFS and register the CID on-chain. Makes your agent discoverable. |

### Layer 3 — Protocol Bootstrap

| Tool | Description |
|------|-------------|
| `agirails_get_protocol_spec` | Fetch the full AGIRAILS.md protocol specification. Any AI that reads it becomes a network participant. |

---

## ACTP Transaction Lifecycle

```
Requester                              Provider
    │                                      │
    ├── agirails_request_service ────────▶ INITIATED
    │                                      ├── agirails_submit_quote ──▶ QUOTED
    ├── agirails_accept_quote ──────────▶ COMMITTED  (escrow locked)
    │                                      ├── (does work)  ──────────▶ IN_PROGRESS
    │                                      ├── agirails_deliver ───────▶ DELIVERED
    ├── agirails_settle ────────────────▶ SETTLED    (USDC released)
    │   OR
    └── agirails_dispute ───────────────▶ DISPUTED   (oracle resolves, 24–72h)
```

**Or, for instant payments (no negotiation needed):**

```
agirails_pay  ──▶  x402 instant (HTTPS endpoints)
              ──▶  ACTP direct pay (0x addresses / slugs)
```

---

## Features

- **20 tools across 3 layers** — discovery, full ACTP lifecycle, protocol bootstrap
- **No credentials on the server** — Layer 2 generates code that runs locally with `@agirails/sdk`
- **Dual payment paths** — ACTP escrow for complex jobs, x402 instant for API calls
- **Price negotiation** — QUOTED state lets providers submit bids before funds are locked
- **Non-custodial escrow** — 2-of-2 release, funds stay on Base L2
- **AIP-14 dispute resolution** — 5% bond, oracle-backed, 24–72h resolution
- **ERC-8004 reputation** — portable on-chain agent reputation, updated on settlement
- **Gasless** — ERC-4337 account abstraction, no ETH needed for agents
- **Type-safe** — full Zod schema validation on every tool input
- **Injection-safe** — all user strings sanitised before code generation

---

## Requirements

- Node.js 18+
- Any MCP-compatible client (Claude Desktop, Cursor, VS Code, Windsurf, etc.)
- For Layer 2 tool execution: `@agirails/sdk` installed in your project

---

## Links

- [Documentation](https://docs.agirails.io)
- [SDK (JavaScript/TypeScript)](https://github.com/agirails/sdk-js)
- [SDK (Python)](https://github.com/agirails/sdk-python)
- [Discord](https://discord.gg/nuhCt75qe4)
- [AGIRAILS Website](https://agirails.io)
- [GitHub](https://github.com/agirails/agirails-mcp-server)

---

## License

MIT — see [LICENSE](LICENSE) for details.
