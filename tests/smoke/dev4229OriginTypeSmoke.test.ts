/**
 * DEV-4229 Smoke Test
 * ===================
 * Real end-to-end smoke for originType forwarding on list_transactions and
 * get_transaction_count. Boots the proven DEV-4228 in-process Transaction API
 * against real Postgres journaler_test (no mocked backend client), then drives
 * createToolRegistry handlers through a real AemBackendClient over HTTP.
 *
 * Run:
 *   npx jest --runInBand --detectOpenHandles --forceExit --config jest.smoke.config.js \
 *     tests/smoke/dev4229OriginTypeSmoke.test.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createAemBackendClient } from '../../src/clients/aem-backend-client';
import { loadEnv } from '../../src/config/env';
import { createToolRegistry, type ToolDefinition } from '../../src/tools/registry';

type SmokeFixture = {
  baseUrl: string;
  token: string;
  userId: number;
  jwtSecret: string;
  manualWalletId: number;
  onChainWalletId: number;
  manualTxCount: number;
  onChainTxCount: number;
  from: string;
  to: string;
  database: string;
};

const HARNESS = path.join(__dirname, 'helpers', 'dev4229-backend-harness.cjs');
const READY_FILE = path.join('/tmp', `dev4229-smoke-ready-${process.pid}.json`);
const SMOKE_PORT = Number(process.env.DEV4229_SMOKE_PORT || 3099);
const HARNESS_TIMEOUT_MS = 120_000;

function logEvidence(label: string, input: Record<string, unknown>, output: unknown): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `=== SMOKE TEST EVIDENCE: ${label} ===`,
      `INPUT:  ${JSON.stringify(input)}`,
      `OUTPUT: ${JSON.stringify(output)}`,
      '='.repeat(40 + label.length),
    ].join('\n'),
  );
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not registered`);
  }
  return tool;
}

function summarizeListResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    return { raw: result };
  }
  const body = result as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<
    string,
    unknown
  >;
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  return {
    status: body.status,
    message: body.message,
    count: data.count ?? transactions.length,
    totalCount: data.totalCount,
    walletIds: transactions.map((tx) => (tx as { walletId?: number }).walletId),
  };
}

function summarizeCountResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    return { raw: result };
  }
  const body = result as Record<string, unknown>;
  if ('data' in body) {
    return { status: body.status, data: body.data, message: body.message };
  }
  return { raw: result };
}

async function waitForHarness(child: ChildProcess): Promise<SmokeFixture> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Harness did not become ready within ${HARNESS_TIMEOUT_MS}ms`));
      }
    }, HARNESS_TIMEOUT_MS);

    const tryParse = (chunk: string) => {
      stdout += chunk;
      const marker = '===SMOKE_READY===';
      const idx = stdout.indexOf(marker);
      if (idx === -1) {
        return;
      }
      const jsonLine = stdout.slice(idx + marker.length).split('\n')[0]?.trim();
      if (!jsonLine) {
        return;
      }
      try {
        const fixture = JSON.parse(jsonLine) as SmokeFixture;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fixture);
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    };

    child.stdout?.on('data', (buf: Buffer) => tryParse(buf.toString('utf8')));
    child.stderr?.on('data', (buf: Buffer) => {
      process.stderr.write(buf);
    });
    child.on('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Harness exited early code=${code} signal=${signal}`));
      }
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

describe('DEV-4229 Smoke — originType forwarding via real AemBackendClient', () => {
  jest.setTimeout(180_000);

  let child: ChildProcess;
  let fixture: SmokeFixture;
  let listTransactions: ToolDefinition;
  let getTransactionCount: ToolDefinition;

  beforeAll(async () => {
    if (fs.existsSync(READY_FILE)) {
      fs.unlinkSync(READY_FILE);
    }

    child = spawn(process.execPath, [HARNESS], {
      env: {
        ...process.env,
        DEV4229_READY_FILE: READY_FILE,
        DEV4229_SMOKE_PORT: String(SMOKE_PORT),
        AEM_BACKEND_ROOT:
          process.env.AEM_BACKEND_ROOT ||
          path.resolve(__dirname, '../../../aem-backend'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    fixture = await waitForHarness(child);

    // eslint-disable-next-line no-console
    console.log('\n--- DEV-4229 MCP smoke fixtures ---', {
      database: fixture.database,
      baseUrl: fixture.baseUrl,
      userId: fixture.userId,
      manualWalletId: fixture.manualWalletId,
      onChainWalletId: fixture.onChainWalletId,
      manualTxCount: fixture.manualTxCount,
      onChainTxCount: fixture.onChainTxCount,
    });

    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '0',
      JWT_SECRET: fixture.jwtSecret,
      AEM_BACKEND_URL: fixture.baseUrl,
      MCP_OAUTH_SIGNING_KEY: 'm'.repeat(32),
    });

    const backend = createAemBackendClient(env);
    const tools = createToolRegistry(backend);
    listTransactions = findTool(tools, 'list_transactions');
    getTransactionCount = findTool(tools, 'get_transaction_count');
  });

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    if (fs.existsSync(READY_FILE)) {
      fs.unlinkSync(READY_FILE);
    }
  });

  const ctx = () => ({
    session: { userId: fixture.userId },
    token: fixture.token,
  });

  it('get_transaction_count originType=MANUAL returns only manual-wallet count', async () => {
    const input = {
      tool: 'get_transaction_count',
      args: {
        originType: 'MANUAL',
        walletIds: String(fixture.manualWalletId),
        from: fixture.from,
        to: fixture.to,
      },
    };
    const result = await getTransactionCount.handler(ctx(), input.args);
    logEvidence('MCP count originType=MANUAL', input, summarizeCountResult(result));

    const body = result as { data?: number } | number;
    const count = typeof body === 'number' ? body : body.data;
    expect(count).toBe(fixture.manualTxCount);
  });

  it('get_transaction_count originType=ALL returns manual + on-chain count', async () => {
    const walletIds = `${fixture.manualWalletId},${fixture.onChainWalletId}`;
    const input = {
      tool: 'get_transaction_count',
      args: {
        originType: 'ALL',
        walletIds,
        from: fixture.from,
        to: fixture.to,
      },
    };
    const result = await getTransactionCount.handler(ctx(), input.args);
    logEvidence('MCP count originType=ALL', input, summarizeCountResult(result));

    const body = result as { data?: number } | number;
    const count = typeof body === 'number' ? body : body.data;
    expect(count).toBe(fixture.manualTxCount + fixture.onChainTxCount);
  });

  it('get_transaction_count with originType omitted forwards no originType (backend default)', async () => {
    // Prove MCP omits the query param; post-DEV-4228 backend default covers all owner wallets.
    const input = {
      tool: 'get_transaction_count',
      args: {
        from: fixture.from,
        to: fixture.to,
      },
    };
    const result = await getTransactionCount.handler(ctx(), input.args);
    logEvidence('MCP count originType=omitted', input, summarizeCountResult(result));

    const body = result as { data?: number } | number;
    const count = typeof body === 'number' ? body : body.data;
    expect(count).toBe(fixture.manualTxCount + fixture.onChainTxCount);
  });

  it('list_transactions originType=MANUAL returns only manual-wallet rows', async () => {
    const input = {
      tool: 'list_transactions',
      args: {
        originType: 'MANUAL',
        walletIds: String(fixture.manualWalletId),
        from: fixture.from,
        to: fixture.to,
        limit: 25,
      },
    };
    const result = await listTransactions.handler(ctx(), input.args);
    const summary = summarizeListResult(result);
    logEvidence('MCP list originType=MANUAL', input, summary);

    expect(summary.totalCount ?? summary.count).toBe(fixture.manualTxCount);
    expect(summary.walletIds).toEqual(
      Array(fixture.manualTxCount).fill(fixture.manualWalletId),
    );
  });

  it('list_transactions originType=ALL returns manual + on-chain rows', async () => {
    const walletIds = `${fixture.manualWalletId},${fixture.onChainWalletId}`;
    const input = {
      tool: 'list_transactions',
      args: {
        originType: 'ALL',
        walletIds,
        from: fixture.from,
        to: fixture.to,
        limit: 25,
      },
    };
    const result = await listTransactions.handler(ctx(), input.args);
    const summary = summarizeListResult(result);
    logEvidence('MCP list originType=ALL', input, summary);

    expect(summary.totalCount ?? summary.count).toBe(
      fixture.manualTxCount + fixture.onChainTxCount,
    );
  });

  it('list_transactions with originType omitted forwards no originType (backend default)', async () => {
    // Date range only (MCP policy allows from+to without walletIds).
    const input = {
      tool: 'list_transactions',
      args: {
        from: fixture.from,
        to: fixture.to,
        limit: 25,
      },
    };
    const result = await listTransactions.handler(ctx(), input.args);
    const summary = summarizeListResult(result);
    logEvidence('MCP list originType=omitted', input, summary);

    expect(summary.totalCount ?? summary.count).toBe(
      fixture.manualTxCount + fixture.onChainTxCount,
    );
    const walletIds = summary.walletIds as number[];
    expect(walletIds).toEqual(
      expect.arrayContaining([fixture.manualWalletId, fixture.onChainWalletId]),
    );
  });
});
