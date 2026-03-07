# Solentic MCP Server

<a href="https://glama.ai/mcp/servers/@blueprint-infrastructure/solentic">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@blueprint-infrastructure/solentic/badge" alt="Solentic MCP server" />
</a>

Standalone [Model Context Protocol](https://modelcontextprotocol.io/) server for [Blueprint Agentic Staking](https://solentic.theblueprint.xyz) — native Solana staking infrastructure for AI agents.

18 MCP tools wrapping the Blueprint REST API. Zero custody — all transactions are unsigned, agents sign client-side.

## Tools

| Tool | Description | Type |
|------|-------------|------|
| `get_validator_info` | Validator profile, commission, active stake, APY | Read |
| `get_staking_apy` | Live APY breakdown (base + Jito MEV) | Read |
| `get_performance_metrics` | Vote success, uptime, skip rate, epoch credits | Read |
| `get_infrastructure` | Server hardware specs (both servers) | Read |
| `generate_wallet` | Local wallet generation code (JS, Python, CLI) | Read |
| `check_balance` | SOL balance for any wallet | Read |
| `create_stake_transaction` | Build unsigned stake transaction | Write |
| `create_unstake_transaction` | Build unsigned unstake transaction | Write |
| `withdraw_stake` | Build unsigned withdraw transaction | Write |
| `submit_transaction` | Submit signed transaction to Solana | Write |
| `check_stake_accounts` | List stake accounts for a wallet | Read |
| `simulate_stake` | Project staking rewards with compound interest | Read |
| `get_staking_summary` | Complete portfolio dashboard (single call) | Read |
| `get_epoch_timing` | Current Solana epoch progress and timing | Read |
| `verify_transaction` | Verify a transaction was built through Blueprint | Read |
| `verify_code_integrity` | Verify deployed source code integrity | Read |
| `get_verification_links` | Third-party verification URLs | Read |
| `donate` | Build unsigned donation transaction | Write |

## Quick Start

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "solentic": {
      "url": "https://solentic.theblueprint.xyz/mcp"
    }
  }
}
```

### Run Locally (stdio)

```bash
npx @mbrassey/solentic-mcp
```

Or clone and run:

```bash
npm install && npm run build
node dist/server.js
```

## Architecture

Lightweight MCP proxy (stdio transport) that wraps the [Blueprint REST API](https://solentic.theblueprint.xyz/api-docs). No Solana RPC access, no private keys, no state — just HTTP calls to the public API.

```
AI Agent → MCP Server (stdio) → Blueprint REST API → Solana
```

## Links

- **Live MCP endpoint:** https://solentic.theblueprint.xyz/mcp
- **API docs:** https://solentic.theblueprint.xyz/docs
- **API explorer:** https://solentic.theblueprint.xyz/api-docs
- **OpenAPI spec:** https://solentic.theblueprint.xyz/openapi.json
- **llms.txt:** https://solentic.theblueprint.xyz/llms.txt

## License

MIT
