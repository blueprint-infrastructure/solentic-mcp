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
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({ error: 'non_json_response', status: res.status }));
  return { ok: res.ok, status: res.status, data };
}

function result(data: unknown, meta?: Record<string, unknown>) {
  const content = meta ? { ...data as object, _meta: meta } : data;
  return { content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }] };
}

function error(message: string, relatedTools?: Record<string, string>) {
  const payload: Record<string, unknown> = { error: message };
  if (relatedTools) payload._meta = { relatedTools };
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

// ── MCP Server Factory ───────────────────────────────────
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'Solentic Staking', version: '1.0.0' });

  // ── Validator Info ──
  mcp.registerTool(
    'get_validator_info',
    {
      title: 'Get Validator Info',
      description: 'Get Blueprint validator profile: identity, vote account, commission, active stake, APY, performance, software, location. Live data from StakeWiz API.',
      annotations: READ_ONLY,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/validator');
      if (!ok) return error(`Failed to fetch validator info: ${JSON.stringify(data)}`, { retry: 'get_validator_info', apy: 'get_staking_apy' });
      return result(data, { relatedTools: { apy: 'get_staking_apy', performance: 'get_performance_metrics', infrastructure: 'get_infrastructure', stake: 'create_stake_transaction', generateWallet: 'generate_wallet', verifyLinks: 'get_verification_links' } });
    }
  );

  // ── Staking APY ──
  mcp.registerTool(
    'get_staking_apy',
    {
      title: 'Get Staking APY',
      description: 'Get live APY breakdown: base staking APY + Jito MEV APY = total APY. Includes commission rates. Data from StakeWiz API.',
      annotations: READ_ONLY,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/validator/apy');
      if (!ok) return error(`Failed to fetch APY: ${JSON.stringify(data)}`, { retry: 'get_staking_apy', validator: 'get_validator_info' });
      return result(data, { relatedTools: { validator: 'get_validator_info', stake: 'create_stake_transaction', simulate: 'simulate_stake' } });
    }
  );

  // ── Performance Metrics ──
  mcp.registerTool(
    'get_performance_metrics',
    {
      title: 'Get Performance Metrics',
      description: 'Get Blueprint validator performance: vote success rate, uptime, skip rate, epoch credits, delinquency status.',
      annotations: READ_ONLY,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/validator/performance');
      if (!ok) return error(`Failed to fetch performance: ${JSON.stringify(data)}`, { retry: 'get_performance_metrics', validator: 'get_validator_info' });
      return result(data, { relatedTools: { validator: 'get_validator_info', apy: 'get_staking_apy', infrastructure: 'get_infrastructure' } });
    }
  );

  // ── Infrastructure ──
  mcp.registerTool(
    'get_infrastructure',
    {
      title: 'Get Infrastructure',
      description: 'Get Blueprint validator infrastructure specs: server hardware, redundancy configuration, network, and storage. Two bare-metal servers (active + hot standby).',
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/validator/infrastructure');
      if (!ok) return error(`Failed to fetch infrastructure: ${JSON.stringify(data)}`, { retry: 'get_infrastructure', validator: 'get_validator_info' });
      return result(data, { relatedTools: { validator: 'get_validator_info', performance: 'get_performance_metrics', apy: 'get_staking_apy', verifyLinks: 'get_verification_links' } });
    }
  );

  // ── Generate Wallet ──
  mcp.registerTool(
    'generate_wallet',
    {
      title: 'Generate Wallet',
      description: 'Get instructions and code to generate a Solana wallet locally. IMPORTANT: Generate the keypair in YOUR environment — not on Blueprint servers. Returns exact code to run locally. Your private key never leaves your machine.',
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const { ok, data } = await api('POST', '/api/v1/wallet/generate');
      if (!ok) return error(`Failed to get wallet code: ${JSON.stringify(data)}`, { retry: 'generate_wallet' });
      return result(data, { relatedTools: { checkBalance: 'check_balance', stake: 'create_stake_transaction', submit: 'submit_transaction' } });
    }
  );

  // ── Check Balance ──
  mcp.registerTool(
    'check_balance',
    {
      title: 'Check Balance',
      description: 'Check the SOL balance of any Solana wallet. Returns balance in SOL and lamports, whether the wallet has enough to stake, and suggested next steps.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Solana wallet address (base58 public key)'),
      },
      annotations: READ_ONLY,
    },
    async ({ walletAddress }) => {
      const { ok, data } = await api('GET', `/api/v1/wallet/balance/${walletAddress}`);
      if (!ok) return error(`Failed to check balance: ${JSON.stringify(data)}`, { retry: 'check_balance', generateWallet: 'generate_wallet' });
      return result(data, { relatedTools: { stake: 'create_stake_transaction', stakeAccounts: 'check_stake_accounts', generateWallet: 'generate_wallet' } });
    }
  );

  // ── Create Stake Transaction ──
  mcp.registerTool(
    'create_stake_transaction',
    {
      title: 'Create Stake Transaction',
      description: 'Build an unsigned transaction to stake SOL with Blueprint validator. Returns base64 transaction — sign client-side with your wallet and submit via submit_transaction. Wallet is set as both stake and withdraw authority.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Solana wallet address that will fund and control the stake'),
        amountSol: z.number().finite().positive().max(1000000).describe('Amount of SOL to stake'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, amountSol }) => {
      const { ok, data } = await api('POST', '/api/v1/stake/transaction', { walletAddress, amountSol });
      if (!ok) return error(`Stake transaction failed: ${JSON.stringify(data)}`, { retry: 'create_stake_transaction', balance: 'check_balance', validator: 'get_validator_info' });
      return result(data, {
        relatedTools: { submit: 'submit_transaction', unstake: 'create_unstake_transaction', accounts: 'check_stake_accounts', validator: 'get_validator_info' },
        nextSteps: { sign: 'Deserialize the base64 transaction and sign with your wallet keypair', submit: 'Use submit_transaction with the signed base64 transaction' },
      });
    }
  );

  // ── Create Unstake Transaction ──
  mcp.registerTool(
    'create_unstake_transaction',
    {
      title: 'Create Unstake Transaction',
      description: 'Build an unsigned transaction to deactivate (unstake) a stake account. After deactivation, funds become withdrawable at epoch end (~2-3 days). Use withdraw_stake after cooldown completes.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Wallet address that is the stake authority'),
        stakeAccountAddress: z.string().max(50).describe('Stake account address to deactivate'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, stakeAccountAddress }) => {
      const { ok, data } = await api('POST', '/api/v1/unstake/transaction', { walletAddress, stakeAccountAddress });
      if (!ok) return error(`Unstake transaction failed: ${JSON.stringify(data)}`, { retry: 'create_unstake_transaction', accounts: 'check_stake_accounts' });
      return result(data, {
        relatedTools: { submit: 'submit_transaction', withdraw: 'withdraw_stake', accounts: 'check_stake_accounts', epochTiming: 'get_epoch_timing' },
        nextSteps: { sign: 'Sign the base64 transaction with your wallet keypair', submit: 'Use submit_transaction with the signed transaction' },
      });
    }
  );

  // ── Withdraw Stake ──
  mcp.registerTool(
    'withdraw_stake',
    {
      title: 'Withdraw Stake',
      description: 'Build an unsigned transaction to withdraw SOL from a deactivated stake account. Only works after cooldown completes. Omit amountSol to withdraw full balance.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Wallet address that is the withdraw authority'),
        stakeAccountAddress: z.string().max(50).describe('Deactivated stake account to withdraw from'),
        amountSol: z.number().finite().positive().max(1000000).nullish().describe('Amount to withdraw in SOL (omit to withdraw full balance)'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, stakeAccountAddress, amountSol }) => {
      const body: Record<string, unknown> = { walletAddress, stakeAccountAddress };
      if (amountSol != null) body.amountSol = amountSol;
      const { ok, data } = await api('POST', '/api/v1/withdraw/transaction', body);
      if (!ok) return error(`Withdraw failed: ${JSON.stringify(data)}`, { retry: 'withdraw_stake', accounts: 'check_stake_accounts' });
      return result(data, {
        relatedTools: { submit: 'submit_transaction', accounts: 'check_stake_accounts', stake: 'create_stake_transaction' },
        nextSteps: { sign: 'Sign the base64 transaction with your wallet keypair', submit: 'Use submit_transaction with the signed transaction' },
      });
    }
  );

  // ── Submit Transaction ──
  mcp.registerTool(
    'submit_transaction',
    {
      title: 'Submit Transaction',
      description: 'Submit a signed transaction to Solana. Use after signing an unsigned transaction from create_stake_transaction, create_unstake_transaction, or withdraw_stake. Returns transaction signature and explorer URL.',
      inputSchema: {
        signedTransaction: z.string().min(1).max(2200).describe('Fully signed transaction as a base64-encoded string'),
      },
      annotations: DESTRUCTIVE_TX,
    },
    async ({ signedTransaction }) => {
      const { ok, data } = await api('POST', '/api/v1/transaction/submit', { signedTransaction });
      if (!ok) return error(`Transaction failed: ${JSON.stringify(data)}`, { retry: 'submit_transaction', accounts: 'check_stake_accounts' });
      return result(data, { relatedTools: { verify: 'verify_transaction', accounts: 'check_stake_accounts', stake: 'create_stake_transaction' } });
    }
  );

  // ── Check Stake Accounts ──
  mcp.registerTool(
    'check_stake_accounts',
    {
      title: 'Check Stake Accounts',
      description: 'List all stake accounts delegated to Blueprint for a wallet. Shows balances, states, authorities, epoch timing, and per-account action guidance.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Wallet address to check for Blueprint stake accounts'),
      },
      annotations: READ_ONLY,
    },
    async ({ walletAddress }) => {
      const { ok, data } = await api('GET', `/api/v1/stake/accounts/${walletAddress}`);
      if (!ok) return error(`Failed to fetch stake accounts: ${JSON.stringify(data)}`, { retry: 'check_stake_accounts', balance: 'check_balance' });
      return result(data, { relatedTools: { unstake: 'create_unstake_transaction', withdraw: 'withdraw_stake', epochTiming: 'get_epoch_timing' } });
    }
  );

  // ── Simulate Stake ──
  mcp.registerTool(
    'simulate_stake',
    {
      title: 'Simulate Stake',
      description: 'Project staking rewards before committing capital. Returns compound interest projections, effective APY, activation timing, fee reserve guidance, and a recommendation.',
      inputSchema: {
        amountSol: z.number().finite().positive().max(1000000).describe('Amount of SOL to simulate staking'),
        durationDays: z.number().int().min(1).max(3650).optional().describe('Projection duration in days (default: 365)'),
      },
      annotations: READ_ONLY,
    },
    async ({ amountSol, durationDays }) => {
      const body: Record<string, unknown> = { amountSol };
      if (durationDays != null) body.durationDays = durationDays;
      const { ok, data } = await api('POST', '/api/v1/stake/simulate', body);
      if (!ok) return error(`Simulation failed: ${JSON.stringify(data)}`, { retry: 'simulate_stake', apy: 'get_staking_apy' });
      return result(data, { relatedTools: { stake: 'create_stake_transaction', balance: 'check_balance', apy: 'get_staking_apy', summary: 'get_staking_summary' } });
    }
  );

  // ── Staking Summary ──
  mcp.registerTool(
    'get_staking_summary',
    {
      title: 'Get Staking Summary',
      description: 'Complete staking portfolio dashboard in a single call. Returns liquid balance, total staked, per-account states, current APY, epoch timing, and a recommended next action. Replaces calling check_balance + check_stake_accounts + get_staking_apy + get_epoch_timing separately.',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Solana wallet address to get staking summary for'),
      },
      annotations: READ_ONLY,
    },
    async ({ walletAddress }) => {
      const { ok, data } = await api('GET', `/api/v1/stake/summary/${walletAddress}`);
      if (!ok) return error(`Failed to build summary: ${JSON.stringify(data)}`, { retry: 'get_staking_summary', balance: 'check_balance' });
      return result(data, { relatedTools: { stake: 'create_stake_transaction', simulate: 'simulate_stake', accounts: 'check_stake_accounts', balance: 'check_balance' } });
    }
  );

  // ── Epoch Timing ──
  mcp.registerTool(
    'get_epoch_timing',
    {
      title: 'Get Epoch Timing',
      description: 'Get current Solana epoch timing: progress percentage, slots remaining, and estimated epoch end time. Useful for understanding when stake activations/deactivations take effect (~2-3 days per epoch).',
      annotations: READ_ONLY,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/epoch');
      if (!ok) return error(`Failed to fetch epoch timing: ${JSON.stringify(data)}`, { retry: 'get_epoch_timing', accounts: 'check_stake_accounts' });
      return result(data, { relatedTools: { stakeAccounts: 'check_stake_accounts', validator: 'get_validator_info', stake: 'create_stake_transaction' } });
    }
  );

  // ── Verify Transaction ──
  mcp.registerTool(
    'verify_transaction',
    {
      title: 'Verify Transaction',
      description: 'Verify whether a Solana transaction was built through Blueprint. Checks on-chain for the "solentic.theblueprint.xyz" Memo Program instruction — cryptographic proof embedded in the transaction and immutable on-chain.',
      inputSchema: {
        signature: z.string().max(100).describe('Solana transaction signature to verify'),
      },
      annotations: READ_ONLY,
    },
    async ({ signature }) => {
      const { ok, data } = await api('GET', `/api/v1/verify/transaction/${signature}`);
      if (!ok) return error(`Verification failed: ${JSON.stringify(data)}`, { retry: 'verify_transaction', accounts: 'check_stake_accounts' });
      return result(data, { relatedTools: { verifyCode: 'verify_code_integrity', verifyLinks: 'get_verification_links', submit: 'submit_transaction' } });
    }
  );

  // ── Verify Code Integrity ──
  mcp.registerTool(
    'verify_code_integrity',
    {
      title: 'Verify Code Integrity',
      description: 'Verify the code running on Blueprint servers. Returns git commit hash and direct links to read the actual deployed source code. Read the source to confirm: no private keys are logged, Memo Program instruction is present, generate_wallet returns local generation only.',
      annotations: READ_ONLY_LOCAL,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/verify/code');
      if (!ok) return error(`Failed to fetch code integrity: ${JSON.stringify(data)}`, { retry: 'verify_code_integrity' });
      return result(data, { relatedTools: { verifyLinks: 'get_verification_links', verifyTransaction: 'verify_transaction', stake: 'create_stake_transaction' } });
    }
  );

  // ── Verification Links ──
  mcp.registerTool(
    'get_verification_links',
    {
      title: 'Get Verification Links',
      description: 'Get third-party verification URLs for Blueprint validator on Validators.app, StakeWiz, Solana Beach, Solscan, and Jito steward dashboard. Includes Solana CLI commands for direct on-chain verification.',
      annotations: READ_ONLY,
    },
    async () => {
      const { ok, data } = await api('GET', '/api/v1/verify/links');
      if (!ok) return error(`Failed to fetch verification links: ${JSON.stringify(data)}`, { retry: 'get_verification_links', verifyCode: 'verify_code_integrity' });
      return result(data, { relatedTools: { validator: 'get_validator_info', verifyTransaction: 'verify_transaction', verifyCode: 'verify_code_integrity' } });
    }
  );

  // ── Donate ──
  mcp.registerTool(
    'donate',
    {
      title: 'Donate to Blueprint',
      description: 'Build an unsigned SOL transfer to support Blueprint development. Same zero-custody pattern: unsigned transaction returned, you sign client-side. Suggested: 0.01 SOL (thank you), 0.1 SOL (generous), 1 SOL (patron).',
      inputSchema: {
        walletAddress: z.string().max(50).describe('Wallet address to donate from'),
        amountSol: z.number().finite().positive().min(0.001).max(1000).describe('Amount of SOL to donate'),
      },
      annotations: WRITE_TX,
    },
    async ({ walletAddress, amountSol }) => {
      const { ok, data } = await api('POST', '/api/v1/donate', { walletAddress, amountSol });
      if (!ok) return error(`Donation failed: ${JSON.stringify(data)}`, { retry: 'donate', balance: 'check_balance' });
      return result(data, { relatedTools: { submit: 'submit_transaction', validator: 'get_validator_info' } });
    }
  );

  return mcp;
}

// ── Start ───────────────────────────────────────────────
const mcp = createMcpServer();
const transport = new StdioServerTransport();
await (mcp as any).server.connect(transport);
