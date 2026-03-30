import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Config ───────────────────────────────────────────────
const API_BASE = process.env.API_BASE || 'https://solentic.theblueprint.xyz';

// ── Annotation presets ───────────────────────────────────
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const READ_ONLY_LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE_TX = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const DESTRUCTIVE_TX = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

// ── Helpers ──────────────────────────────────────────────
async function api(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method,
    headers,
    signal: AbortSignal.timeout(30_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({ error: 'non_json_response', status: res.status }));
  return { ok: res.ok, status: res.status, data };
}

function result(data: unknown, meta?: Record<string, unknown>) {
  const content = meta ? { ...data as object, _meta: meta } : data;
  return { content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }] };
}

function error(message: string, relatedTools?: Record<string, string>, errorCode?: string) {
  const payload: Record<string, unknown> = { error: message };
  if (errorCode) payload.errorCode = errorCode;
  if (relatedTools) payload._meta = { relatedTools };
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

// ── MCP Server Factory ───────────────────────────────────
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'Solentic Staking', version: '1.1.0' });

  // ════════════════════════════════════════════════════════
  //  AGENT-FIRST: One-shot tools (build + sign + submit)
  // ════════════════════════════════════════════════════════

  mcp.registerTool(
    'stake',
    {
      title: 'Stake SOL (one-shot)',
      description: 'Stake SOL with Blueprint validator in a single call. Your secret key is sent to the Blueprint server over HTTPS, used in-memory for signing, and discarded — never stored or logged. Returns the confirmed transaction signature. Verify via verify_code_integrity. This is the recommended tool for autonomous agents.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Your Solana wallet address (base58 public key)'),
        secretKey: z.string().min(80).max(100).describe('Your base58-encoded secret key — sent to Blueprint server over HTTPS for in-memory signing, never stored or logged'),
        amountSol: z.number().finite().positive().max(9000000).describe('Amount of SOL to stake'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, secretKey, amountSol }) => {
      const { ok, data } = await api('POST', '/api/v1/stake', { walletAddress, secretKey, amountSol });
      if (!ok) return error(`Stake failed: ${(data as any)?.message || JSON.stringify(data)}`, { retry: 'stake', balance: 'check_balance', simulate: 'simulate_stake' });
      return result(data, { relatedTools: { accounts: 'check_stake_accounts', summary: 'get_staking_summary', verify: 'verify_transaction' } });
    }
  );

  mcp.registerTool(
    'unstake',
    {
      title: 'Unstake SOL (one-shot)',
      description: 'Deactivate a stake account in a single call. Secret key sent over HTTPS for in-memory signing, never stored. Cooldown ~1 epoch. Use check_withdraw_ready to poll, then withdraw.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Your Solana wallet address (stake authority)'),
        secretKey: z.string().min(80).max(100).describe('Your base58-encoded secret key — sent to Blueprint server over HTTPS for in-memory signing, never stored or logged'),
        stakeAccountAddress: z.string().max(50).describe('Stake account address to deactivate'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, secretKey, stakeAccountAddress }) => {
      const { ok, data } = await api('POST', '/api/v1/unstake', { walletAddress, secretKey, stakeAccountAddress });
      if (!ok) return error(`Unstake failed: ${(data as any)?.message || JSON.stringify(data)}`, { retry: 'unstake', accounts: 'check_stake_accounts' });
      return result(data, { relatedTools: { withdrawReady: 'check_withdraw_ready', withdraw: 'withdraw', epochTiming: 'get_epoch_timing' } });
    }
  );

  mcp.registerTool(
    'withdraw',
    {
      title: 'Withdraw SOL (one-shot)',
      description: 'Withdraw SOL from a deactivated stake account in a single call. Secret key sent over HTTPS for in-memory signing, never stored. Use check_withdraw_ready first. Omit amountSol for full balance.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Your Solana wallet address (withdraw authority)'),
        secretKey: z.string().min(80).max(100).describe('Your base58-encoded secret key — sent to Blueprint server over HTTPS for in-memory signing, never stored or logged'),
        stakeAccountAddress: z.string().max(50).describe('Deactivated stake account to withdraw from'),
        amountSol: z.number().finite().positive().max(9000000).nullish().describe('Amount to withdraw in SOL (omit to withdraw full balance)'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, secretKey, stakeAccountAddress, amountSol }) => {
      const body: Record<string, unknown> = { walletAddress, secretKey, stakeAccountAddress };
      if (amountSol != null) body.amountSol = amountSol;
      const { ok, data } = await api('POST', '/api/v1/withdraw', body);
      if (!ok) return error(`Withdraw failed: ${(data as any)?.message || JSON.stringify(data)}`, { retry: 'withdraw', withdrawReady: 'check_withdraw_ready', accounts: 'check_stake_accounts' });
      return result(data, { relatedTools: { balance: 'check_balance', stake: 'stake' } });
    }
  );

  // ════════════════════════════════════════════════════════
  //  INFO & MONITORING
  // ════════════════════════════════════════════════════════

  mcp.registerTool('get_validator_info', { title: 'Get Validator Info', description: 'Get Blueprint validator profile: identity, vote account, commission, active stake, APY, performance, software, location. Live data from StakeWiz API.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/validator'); if (!ok) return error(`Failed to fetch validator info`, { retry: 'get_validator_info', apy: 'get_staking_apy' }); return result(data, { relatedTools: { apy: 'get_staking_apy', performance: 'get_performance_metrics', infrastructure: 'get_infrastructure', stake: 'stake' } }); });

  mcp.registerTool('get_staking_apy', { title: 'Get Staking APY', description: 'Get live APY breakdown: base staking APY + Jito MEV APY = total APY. Includes commission rates.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/validator/apy'); if (!ok) return error(`Failed to fetch APY`, { retry: 'get_staking_apy', validator: 'get_validator_info' }); return result(data, { relatedTools: { validator: 'get_validator_info', stake: 'stake', simulate: 'simulate_stake' } }); });

  mcp.registerTool('get_performance_metrics', { title: 'Get Performance Metrics', description: 'Get Blueprint validator performance: vote success rate, uptime, skip rate, epoch credits, delinquency status.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/validator/performance'); if (!ok) return error(`Failed to fetch performance`, { retry: 'get_performance_metrics', validator: 'get_validator_info' }); return result(data, { relatedTools: { validator: 'get_validator_info', apy: 'get_staking_apy', infrastructure: 'get_infrastructure' } }); });

  mcp.registerTool('get_infrastructure', { title: 'Get Infrastructure', description: 'Get Blueprint validator infrastructure specs: server hardware, redundancy configuration, network, and storage. Two bare-metal servers (active + hot standby).', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/validator/infrastructure'); if (!ok) return error(`Failed to fetch infrastructure`, { retry: 'get_infrastructure', validator: 'get_validator_info' }); return result(data, { relatedTools: { validator: 'get_validator_info', performance: 'get_performance_metrics' } }); });

  mcp.registerTool('generate_wallet', { title: 'Generate Wallet', description: 'Get instructions and code to generate a Solana wallet locally. Generate the keypair in YOUR environment. After generating, fund the wallet, then use the `stake` tool with your walletAddress + secretKey to stake in one call.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('POST', '/api/v1/wallet/generate'); if (!ok) return error(`Failed to get wallet code`, { retry: 'generate_wallet' }); return result(data, { relatedTools: { checkBalance: 'check_balance', stake: 'stake' } }); });

  mcp.registerTool('check_balance', { title: 'Check Balance', description: 'Check the SOL balance of any Solana wallet address. Returns balance in SOL, ready-to-stake status, and next steps.', inputSchema: { walletAddress: z.string().max(50).describe('Solana wallet address (base58 public key)') }, annotations: READ_ONLY },
    async ({ walletAddress }) => { const { ok, data } = await api('GET', `/api/v1/wallet/balance/${walletAddress}`); if (!ok) return error(`Failed to check balance`, { retry: 'check_balance', generateWallet: 'generate_wallet' }); return result(data, { relatedTools: { stake: 'stake', stakeAccounts: 'check_stake_accounts' } }); });

  mcp.registerTool('check_stake_accounts', { title: 'Check Stake Accounts', description: 'List all stake accounts delegated to Blueprint for a wallet. Shows balances, states, stateDescription, authorities, epoch timing, and per-account action guidance.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address to check') }, annotations: READ_ONLY },
    async ({ walletAddress }) => { const { ok, data } = await api('GET', `/api/v1/stake/accounts/${walletAddress}`); if (!ok) return error(`Failed to fetch accounts`, { retry: 'check_stake_accounts', balance: 'check_balance' }); return result(data, { relatedTools: { unstake: 'unstake', withdraw: 'withdraw', epochTiming: 'get_epoch_timing' } }); });

  mcp.registerTool('check_withdraw_ready', { title: 'Check Withdraw Ready', description: 'Check whether stake accounts are ready to withdraw. Returns per-account readiness with withdrawable epoch, estimated seconds remaining, and plain-English state description. Use this instead of polling check_stake_accounts.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address to check') }, annotations: READ_ONLY },
    async ({ walletAddress }) => { const { ok, data } = await api('GET', `/api/v1/stake/accounts/${walletAddress}/withdraw-ready`); if (!ok) return error(`Failed to check readiness`, { retry: 'check_withdraw_ready', accounts: 'check_stake_accounts' }); return result(data, { relatedTools: { withdraw: 'withdraw', unstake: 'unstake', epochTiming: 'get_epoch_timing' } }); });

  mcp.registerTool('simulate_stake', { title: 'Simulate Stake', description: 'Project staking rewards before committing capital. Returns compound interest projections, effective APY, activation timing, fee reserve guidance, and a recommendation.', inputSchema: { amountSol: z.number().finite().positive().max(9000000).describe('Amount of SOL to simulate'), durationDays: z.number().int().min(1).max(3650).optional().describe('Duration in days (default: 365)') }, annotations: READ_ONLY },
    async ({ amountSol, durationDays }) => { const body: Record<string, unknown> = { amountSol }; if (durationDays != null) body.durationDays = durationDays; const { ok, data } = await api('POST', '/api/v1/stake/simulate', body); if (!ok) return error(`Simulation failed`, { retry: 'simulate_stake', apy: 'get_staking_apy' }); return result(data, { relatedTools: { stake: 'stake', balance: 'check_balance', summary: 'get_staking_summary' } }); });

  mcp.registerTool('get_staking_summary', { title: 'Get Staking Summary', description: 'Complete staking portfolio dashboard in a single call. Returns liquid balance, total staked, per-account states, APY, epoch timing, and recommended next action (STAKE/FUND/HOLD/WAIT/WITHDRAW).', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address') }, annotations: READ_ONLY },
    async ({ walletAddress }) => { const { ok, data } = await api('GET', `/api/v1/stake/summary/${walletAddress}`); if (!ok) return error(`Failed to build summary`, { retry: 'get_staking_summary', balance: 'check_balance' }); return result(data, { relatedTools: { stake: 'stake', simulate: 'simulate_stake', accounts: 'check_stake_accounts' } }); });

  mcp.registerTool('get_epoch_timing', { title: 'Get Epoch Timing', description: 'Get current Solana epoch timing: progress percentage, slots remaining, and estimated epoch end time.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/epoch'); if (!ok) return error(`Failed to fetch epoch timing`, { retry: 'get_epoch_timing' }); return result(data, { relatedTools: { stakeAccounts: 'check_stake_accounts', withdrawReady: 'check_withdraw_ready' } }); });

  mcp.registerTool('check_address_type', { title: 'Check Address Type', description: 'Detect whether a Solana address is a wallet, stake account, or vote account. Useful when you receive an address from user input.', inputSchema: { address: z.string().max(50).describe('Solana address to identify') }, annotations: READ_ONLY },
    async ({ address }) => { const { ok, data } = await api('GET', `/api/v1/address/${address}/type`); if (!ok) return error(`Failed to check address type`, { retry: 'check_address_type', balance: 'check_balance' }); return result(data, { relatedTools: { balance: 'check_balance', accounts: 'check_stake_accounts' } }); });

  // ════════════════════════════════════════════════════════
  //  VERIFICATION
  // ════════════════════════════════════════════════════════

  mcp.registerTool('verify_transaction', { title: 'Verify Transaction', description: 'Verify whether a Solana transaction was built through Blueprint. Checks on-chain for the "solentic.theblueprint.xyz" Memo — cryptographic proof.', inputSchema: { signature: z.string().max(100).describe('Transaction signature to verify') }, annotations: READ_ONLY },
    async ({ signature }) => { const { ok, data } = await api('GET', `/api/v1/verify/transaction/${signature}`); if (!ok) return error(`Verification failed`, { retry: 'verify_transaction' }); return result(data, { relatedTools: { verifyCode: 'verify_code_integrity', verifyLinks: 'get_verification_links' } }); });

  mcp.registerTool('verify_code_integrity', { title: 'Verify Code Integrity', description: 'Verify the code running on Blueprint servers. Returns git commit hash and direct links to read the actual deployed source code.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/verify/code'); if (!ok) return error(`Failed to fetch code integrity`, { retry: 'verify_code_integrity' }); return result(data, { relatedTools: { verifyLinks: 'get_verification_links', verifyTransaction: 'verify_transaction' } }); });

  mcp.registerTool('get_verification_links', { title: 'Get Verification Links', description: 'Get third-party verification URLs for Blueprint validator on Validators.app, StakeWiz, Solana Beach, Solscan, and Jito.', annotations: READ_ONLY },
    async () => { const { ok, data } = await api('GET', '/api/v1/verify/links'); if (!ok) return error(`Failed to fetch links`, { retry: 'get_verification_links' }); return result(data, { relatedTools: { validator: 'get_validator_info', verifyCode: 'verify_code_integrity' } }); });

  // ════════════════════════════════════════════════════════
  //  ADVANCED: Unsigned transaction builders (local signing)
  // ════════════════════════════════════════════════════════

  mcp.registerTool('create_stake_transaction', { title: 'Create Stake Transaction', description: 'Advanced: Build an unsigned stake transaction for local signing. Most agents should use the `stake` tool instead.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address'), amountSol: z.number().finite().positive().max(9000000).describe('SOL to stake') }, annotations: WRITE_TX },
    async ({ walletAddress, amountSol }) => { const { ok, data } = await api('POST', '/api/v1/stake/transaction', { walletAddress, amountSol }); if (!ok) return error(`Stake tx failed`, { retry: 'create_stake_transaction', balance: 'check_balance' }); return result(data, { relatedTools: { submit: 'submit_transaction', accounts: 'check_stake_accounts' } }); });

  mcp.registerTool('create_unstake_transaction', { title: 'Create Unstake Transaction', description: 'Advanced: Build an unsigned unstake transaction for local signing. Most agents should use the `unstake` tool instead.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address'), stakeAccountAddress: z.string().max(50).describe('Stake account to deactivate') }, annotations: WRITE_TX },
    async ({ walletAddress, stakeAccountAddress }) => { const { ok, data } = await api('POST', '/api/v1/unstake/transaction', { walletAddress, stakeAccountAddress }); if (!ok) return error(`Unstake tx failed`, { retry: 'create_unstake_transaction', accounts: 'check_stake_accounts' }); return result(data, { relatedTools: { submit: 'submit_transaction', withdraw: 'withdraw_stake' } }); });

  mcp.registerTool('withdraw_stake', { title: 'Withdraw Stake', description: 'Advanced: Build an unsigned withdraw transaction for local signing. Most agents should use the `withdraw` tool instead.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address'), stakeAccountAddress: z.string().max(50).describe('Stake account'), amountSol: z.number().finite().positive().max(9000000).nullish().describe('SOL to withdraw (omit for full)') }, annotations: WRITE_TX },
    async ({ walletAddress, stakeAccountAddress, amountSol }) => { const body: Record<string, unknown> = { walletAddress, stakeAccountAddress }; if (amountSol != null) body.amountSol = amountSol; const { ok, data } = await api('POST', '/api/v1/withdraw/transaction', body); if (!ok) return error(`Withdraw tx failed`, { retry: 'withdraw_stake', accounts: 'check_stake_accounts' }); return result(data, { relatedTools: { submit: 'submit_transaction', accounts: 'check_stake_accounts' } }); });

  mcp.registerTool('submit_transaction', { title: 'Submit Transaction', description: 'Advanced: Submit a pre-signed transaction to Solana. Only needed with create_stake_transaction/create_unstake_transaction/withdraw_stake. Most agents should use the one-shot stake/unstake/withdraw tools instead.', inputSchema: { signedTransaction: z.string().min(1).max(2200).describe('Signed base64 transaction') }, annotations: DESTRUCTIVE_TX },
    async ({ signedTransaction }) => { const { ok, data } = await api('POST', '/api/v1/transaction/submit', { signedTransaction }); if (!ok) { const resp = data as Record<string, unknown>; return error(typeof resp.message === 'string' ? resp.message : `Transaction failed`, { retry: 'submit_transaction', accounts: 'check_stake_accounts' }, typeof resp.errorCode === 'string' ? resp.errorCode : undefined); } return result(data, { relatedTools: { verify: 'verify_transaction', accounts: 'check_stake_accounts' } }); });

  // ════════════════════════════════════════════════════════
  //  WEBHOOKS
  // ════════════════════════════════════════════════════════

  mcp.registerTool('register_webhook', { title: 'Register Webhook', description: 'Register a callback URL to receive push notifications when stake state changes. Events: withdraw_ready, epoch_complete, stake_activated, stake_deactivated. Polls every 60s. Returns an HMAC secret for signature verification.', inputSchema: { callbackUrl: z.string().url().optional().describe('HTTPS callback URL'), url: z.string().url().optional().describe('Alias for callbackUrl — either field works'), walletAddress: z.string().max(50).describe('Wallet to monitor'), events: z.array(z.enum(['withdraw_ready', 'epoch_complete', 'stake_activated', 'stake_deactivated'])).min(1).max(4).describe('Event types') }, annotations: WRITE_TX },
    async ({ callbackUrl, url, walletAddress, events }) => { const resolved = callbackUrl || url; if (!resolved) return error('Provide callbackUrl or url', { retry: 'register_webhook' }); const { ok, data } = await api('POST', '/api/v1/webhooks', { callbackUrl: resolved, walletAddress, events }); if (!ok) return error(`Failed to register webhook`, { retry: 'register_webhook' }); return result(data, { relatedTools: { list: 'list_webhooks', delete: 'delete_webhook' } }); });

  mcp.registerTool('list_webhooks', { title: 'List Webhooks', description: 'List all registered webhooks for a wallet address.', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address') }, annotations: READ_ONLY },
    async ({ walletAddress }) => { const { ok, data } = await api('GET', `/api/v1/webhooks/${walletAddress}`); if (!ok) return error(`Failed to list webhooks`, { retry: 'list_webhooks' }); return result(data, { relatedTools: { register: 'register_webhook', delete: 'delete_webhook' } }); });

  mcp.registerTool('delete_webhook', { title: 'Delete Webhook', description: 'Delete a webhook registration by ID. Use list_webhooks to find IDs.', inputSchema: { webhookId: z.string().describe('Webhook ID to delete') }, annotations: WRITE_TX },
    async ({ webhookId }) => { const { ok, data } = await api('DELETE', `/api/v1/webhooks/${webhookId}`); if (!ok) return error(`Failed to delete webhook`, { list: 'list_webhooks' }); return result(data, { relatedTools: { register: 'register_webhook', list: 'list_webhooks' } }); });

  // ════════════════════════════════════════════════════════
  //  SUPPORT
  // ════════════════════════════════════════════════════════

  mcp.registerTool('donate', { title: 'Donate to Blueprint', description: 'Build an unsigned SOL transfer to support Blueprint development. Same zero-custody pattern. Suggested: 0.01 SOL (thank you), 0.1 SOL (generous), 1 SOL (patron).', inputSchema: { walletAddress: z.string().max(50).describe('Wallet address'), amountSol: z.number().finite().positive().min(0.001).max(1000).describe('SOL to donate') }, annotations: WRITE_TX },
    async ({ walletAddress, amountSol }) => { const { ok, data } = await api('POST', '/api/v1/donate', { walletAddress, amountSol }); if (!ok) return error(`Donation failed`, { retry: 'donate', balance: 'check_balance' }); return result(data, { relatedTools: { submit: 'submit_transaction', validator: 'get_validator_info' } }); });

  return mcp;
}

// ── Start ───────────────────────────────────────────────
const mcp = createMcpServer();
const transport = new StdioServerTransport();
await (mcp as any).server.connect(transport);
