# Solentic MCP Server

<a href="https://glama.ai/mcp/servers/@blueprint-infrastructure/solentic">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@blueprint-infrastructure/solentic/badge" alt="Solentic MCP server" />
</a>

Standalone [Model Context Protocol](https://modelcontextprotocol.io/) server for [Blueprint Agentic Staking](https://solentic.theblueprint.xyz) — native Solana staking infrastructure for AI agents.

26 MCP tools wrapping the Blueprint REST API. One-shot tools (`stake`, `unstake`, `withdraw`) handle the full lifecycle in a single call — the secret key is sent to the Blueprint server over HTTPS for in-memory signing and is never stored or logged. Verify via `verify_code_integrity`. Advanced tools (`create_stake_transaction`, etc.) return unsigned transactions for agents that prefer local signing.

## Tools

**Agent-first (one-shot — build + sign + submit in one call):**

| Tool | Description | Type |
|------|-------------|------|
| `stake` | Stake SOL — one call, confirmed signature returned | Write |
| `unstake` | Deactivate stake — one call, confirmed | Write |
| `withdraw` | Withdraw SOL — one call, confirmed | Write |

**Info & monitoring:**

| Tool | Description | Type |
|------|-------------|------|
| `get_validator_info` | Validator profile, commission, active stake, APY | Read |
| `get_staking_apy` | Live APY breakdown (base + Jito MEV) | Read |
| `get_performance_metrics` | Vote success, uptime, skip rate, epoch credits | Read |
| `get_infrastructure` | Server hardware specs (both servers) | Read |
| `generate_wallet` | Local wallet generation code (JS, Python, CLI) | Read |
| `check_balance` | SOL balance for any wallet | Read |
| `check_stake_accounts` | List stake accounts for a wallet | Read |
| `check_withdraw_ready` | Per-account withdrawal readiness with ETA | Read |
| `simulate_stake` | Project staking rewards with compound interest | Read |
| `get_staking_summary` | Complete portfolio dashboard (single call) | Read |
| `get_epoch_timing` | Current Solana epoch progress and timing | Read |
| `check_address_type` | Detect wallet vs stake account vs vote account | Read |

**Verification:**

| Tool | Description | Type |
|------|-------------|------|
| `verify_transaction` | Verify a transaction was built through Blueprint | Read |
| `verify_code_integrity` | Verify deployed source code integrity | Read |
| `get_verification_links` | Third-party verification URLs | Read |

**Advanced (unsigned transaction builders — for local signing):**

| Tool | Description | Type |
|------|-------------|------|
| `create_stake_transaction` | Build unsigned stake transaction | Write |
| `create_unstake_transaction` | Build unsigned unstake transaction | Write |
| `withdraw_stake` | Build unsigned withdraw transaction | Write |
| `submit_transaction` | Submit a pre-signed transaction to Solana | Write |

**Webhooks:**

| Tool | Description | Type |
|------|-------------|------|
| `register_webhook` | Register push notification for state changes | Write |
| `list_webhooks` | List registered webhooks for a wallet | Read |
| `delete_webhook` | Delete a webhook registration | Write |

**Support:**

| Tool | Description | Type |
|------|-------------|------|
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

Lightweight MCP proxy (stdio transport) that wraps the [Blueprint REST API](https://solentic.theblueprint.xyz/api-docs).

- **One-shot tools** (`stake`, `unstake`, `withdraw`): accept a secret key, forward it to the Blueprint server over HTTPS for in-memory signing. The key is used only for transaction signing on the server and is never stored or logged — [verify the source code](https://solentic.theblueprint.xyz/api/v1/verify/source/stake-routes.ts).
- **Advanced tools** (`create_stake_transaction`, etc.): return unsigned transactions. No secret key required — agents sign locally.
- **Read tools**: no keys involved, purely informational.

```
AI Agent → MCP Server (stdio) → Blueprint REST API (HTTPS) → Solana
```

## Links

- **Live MCP endpoint:** https://solentic.theblueprint.xyz/mcp
- **API docs:** https://solentic.theblueprint.xyz/docs
- **API explorer:** https://solentic.theblueprint.xyz/api-docs
- **OpenAPI spec:** https://solentic.theblueprint.xyz/openapi.json
- **llms.txt:** https://solentic.theblueprint.xyz/llms.txt

## License

MIT
