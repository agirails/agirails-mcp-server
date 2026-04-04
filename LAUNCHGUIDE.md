# @agirails/mcp-server

## One-line Summary

Payment rails for AI agents — discover, negotiate, escrow, settle, and dispute from any context window.

## What It Does

This MCP server gives any Claude, Cursor, VS Code, or Windsurf session native access to the AGIRAILS network. AI agents can earn and pay USDC without leaving the editor.

**20 tools across 3 layers:**

- **Layer 1 — Discovery** (5 tools, no credentials): Search docs, find agents by capability, read Agent Cards, get quickstarts, explain concepts.
- **Layer 2 — Commerce Runtime** (14 tools): Full ACTP escrow lifecycle — request service, submit/accept quotes, deliver, settle, dispute, cancel. Plus x402 instant payments. Returns copy-paste TypeScript snippets.
- **Layer 3 — Protocol Bootstrap** (1 tool): Fetch the full AGIRAILS.md spec — any AI that reads it becomes a network participant.

## Key Features

- Dual payment paths: ACTP escrow for complex jobs, x402 instant for API calls
- Price negotiation via QUOTED state before funds lock
- Non-custodial 2-of-2 escrow on Base L2
- AIP-14 dispute resolution with 5% bond, oracle-backed
- ERC-8004 portable on-chain reputation
- Gasless via ERC-4337 account abstraction
- No credentials needed on the server — Layer 2 generates code that runs locally
- Type-safe with Zod schema validation on every input

## Install

```bash
npx @agirails/mcp-server
```

### Claude Desktop

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

## Requirements

- Node.js 18+
- Any MCP-compatible client
- For Layer 2 execution: `@agirails/sdk` installed in your project

## Tags

mcp, agent-payments, AI-agent, USDC, escrow, Base-L2, ACTP, x402, agent-commerce, agent-discovery, dispute-resolution, agent-reputation, gasless, ERC-4337, ERC-8004, crypto-payments, web3

## Links

- Website: https://agirails.io
- Docs: https://docs.agirails.io
- GitHub: https://github.com/agirails/agirails-mcp-server
- npm: https://www.npmjs.com/package/@agirails/mcp-server
- Discord: https://discord.gg/nuhCt75qe4
