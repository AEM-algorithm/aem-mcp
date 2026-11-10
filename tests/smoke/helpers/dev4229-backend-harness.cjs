#!/usr/bin/env node
/**
 * Boots the DEV-4228-style in-process Transaction API against real Postgres
 * journaler_test, seeds MANUAL + on-chain fixtures, and keeps listening so
 * aem-mcp can exercise a real AemBackendClient (no mocks).
 *
 * Run from anywhere:
 *   node tests/smoke/helpers/dev4229-backend-harness.cjs
 *
 * Prints one line: ===SMOKE_READY==={...json...}
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const AEM_BACKEND = process.env.AEM_BACKEND_ROOT
  || path.resolve(__dirname, '../../../../aem-backend');
const READY_PATH = process.env.DEV4229_READY_FILE
  || path.join('/tmp', 'dev4229-smoke-ready.json');
const LISTEN_PORT = Number(process.env.DEV4229_SMOKE_PORT || 3099);

if (!fs.existsSync(AEM_BACKEND)) {
  console.error(`aem-backend not found at ${AEM_BACKEND}`);
  process.exit(1);
}

process.chdir(AEM_BACKEND);
// Resolve dependencies from aem-backend even though this file lives in aem-mcp.
const backendRequire = Module.createRequire(path.join(AEM_BACKEND, 'package.json'));
const nodePathParts = [
  path.join(AEM_BACKEND, 'node_modules'),
  ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []),
];
process.env.NODE_PATH = nodePathParts.join(path.delimiter);
Module._initPaths();

// Minimal Jest polyfill so walletTestHelpers can load outside Jest.
function jestFn(impl) {
  const state = { impl: typeof impl === 'function' ? impl : undefined };
  const fn = (...args) => (state.impl ? state.impl(...args) : undefined);
  fn.mockResolvedValue = (value) => {
    state.impl = async () => value;
    return fn;
  };
  fn.mockImplementation = (next) => {
    state.impl = next;
    return fn;
  };
  fn.mockReturnValue = (value) => {
    state.impl = () => value;
    return fn;
  };
  return fn;
}

global.jest = {
  fn: jestFn,
  mock() {},
  requireActual: (id) => require(id),
  setTimeout() {},
  spyOn() {
    return { mockImplementation: () => ({}), mockReturnValue: () => ({}) };
  },
};

backendRequire('dotenv').config({ path: path.join(AEM_BACKEND, '.env') });

process.env.NODE_ENV = 'test';
process.env.DATABASE_ONLY = 'true';
process.env.DB_DIALECT = 'postgres';
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'journaler_test';
process.env.DB_DATABASE = process.env.TEST_DB_NAME;
process.env.DB_NAME = process.env.TEST_DB_NAME;
process.env.ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
process.env.JWT_SECRET = process.env.JWT_SECRET || '1234';

async function ensureTestDatabase() {
  const { Client } = backendRequire('pg');
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const testDb = process.env.TEST_DB_NAME;

  const admin = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDb],
    );
    if (existing.rowCount !== 0) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [testDb],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${testDb}"`);
      await new Promise((r) => setTimeout(r, 300));
    }
    await admin.query(`CREATE DATABASE "${testDb}"`);
    console.error(`Created test database "${testDb}"`);
  } finally {
    await admin.end();
  }
}

async function main() {
  await ensureTestDatabase();

  backendRequire('ts-node').register({
    transpileOnly: true,
    project: path.join(AEM_BACKEND, 'tsconfig.json'),
    compilerOptions: { module: 'commonjs' },
  });
  backendRequire('tsconfig-paths').register({
    baseUrl: AEM_BACKEND,
    paths: { '@src/*': ['src/*'] },
  });
  backendRequire('reflect-metadata');

  const pathMod = require('path');
  const { sequelize } = backendRequire('./src/infrastructure/persistence/sequelize');
  const modelsDir = pathMod.resolve(AEM_BACKEND, 'src/infrastructure/persistence/model');
  sequelize.addModels([modelsDir]);
  await sequelize.authenticate();
  await sequelize.sync({ force: true });

  const express = backendRequire('express');
  const cookieParser = backendRequire('cookie-parser');
  const { Router } = express;

  const {
    cleanTestDatabase,
    createTestUser,
    generateAuthTokens,
    setupWalletServices,
    mockMailNotificationUseCase,
    mockNotificationUseCase,
    mockXeroExportService,
  } = backendRequire('./tests/setup/walletTestHelpers');

  const { BaseWalletModel } = backendRequire('./src/infrastructure/persistence/model/BaseWalletModel');
  const { TransactionModel } = backendRequire('./src/infrastructure/persistence/model/TransactionModel');
  const { WalletOriginType } = backendRequire('./src/infrastructure/persistence/model/WalletModel');
  const { TransactionType, AcceptedCrypto, AcceptedFiat } = backendRequire('./src/domain/entity/Transaction');
  const { WalletType } = backendRequire('./src/domain/entity/Wallet');
  const { TransactionController } = backendRequire('./src/app/controller/TransactionController');

  await cleanTestDatabase();
  const services = setupWalletServices();

  const ResourcesMiddleware = backendRequire('./src/app/middleware/ResourcesMiddleware').ResourcesMiddleware;
  const CompanyResourcesMiddleware = backendRequire('./src/app/middleware/CompanyResourcesMiddleware').CompanyResourcesMiddleware;
  const StorageUseCase = backendRequire('./src/domain/usecase/StorageUseCase').StorageUseCase;
  const SettingsUseCase = backendRequire('./src/domain/usecase/SettingsUseCase').SettingsUseCase;
  const ImportedTransactionUseCase = backendRequire('./src/domain/usecase/ImportedTransactionUseCase').ImportedTransactionUseCase;
  const SequelizeManualTransactionRepository = backendRequire('./src/infrastructure/persistence/SequelizeManualTransactionRepository').SequelizeManualTransactionRepository;
  const SequelizeSettingsRepository = backendRequire('./src/infrastructure/persistence/SequelizeSettingsRepository').SequelizeSettingsRepository;
  const SequelizeUserResourcesRepository = backendRequire('./src/infrastructure/persistence/SequelizeUserResourcesRepository').SequelizeUserResourcesRepository;
  const SequelizeCompanyResourceRepository = backendRequire('./src/infrastructure/persistence/SequelizeCompanyResourceRepository').SequelizeCompanyResourceRepository;

  const userResourcesRepository = new SequelizeUserResourcesRepository();
  const companyResourcesRepository = new SequelizeCompanyResourceRepository();
  const resourcesMiddleware = new ResourcesMiddleware(userResourcesRepository, services.userUseCase);
  const companyResourcesMiddleware = new CompanyResourcesMiddleware(companyResourcesRepository);
  const storageUseCase = new StorageUseCase({ saveFile: async () => undefined });
  const settingsRepository = new SequelizeSettingsRepository();
  const settingsUseCase = new SettingsUseCase(settingsRepository);
  const importedTransactionRepository = new SequelizeManualTransactionRepository();
  const importedTransactionUseCase = new ImportedTransactionUseCase(
    importedTransactionRepository,
    services.transactionUseCase,
    services.priceConvertUseCase,
  );

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  const transactionController = new TransactionController(
    services.sessionMiddleware,
    services.subscriptionMiddleware,
    resourcesMiddleware,
    companyResourcesMiddleware,
    services.transactionUseCase,
    services.userUseCase,
    services.walletUseCase,
    services.comWalletUseCase,
    services.companyUseCase,
    services.priceConvertUseCase,
    mockMailNotificationUseCase,
    mockNotificationUseCase,
    storageUseCase,
    settingsUseCase,
    mockXeroExportService,
    importedTransactionUseCase,
  );

  app.use(services.sessionMiddleware.session);
  const router = Router();
  transactionController.registerRoutes(router);
  app.use('/api', router);
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'dev4229-harness' }));

  const MANUAL_TX_COUNT = 4;
  const ON_CHAIN_TX_COUNT = 2;
  const userData = await createTestUser();
  const user = userData.user;
  const authToken = generateAuthTokens(user).authToken;

  async function createTx(userId, walletId, index, address, manualWalletId) {
    await TransactionModel.create({
      userId,
      walletId,
      manual_wallet_id: manualWalletId ?? null,
      from: address,
      to: '0x3333333333333333333333333333333333333334',
      date: new Date(),
      hash: `0xhash-mcp-smoke-${walletId}-${index}`,
      type: TransactionType.BUY,
      currency: AcceptedCrypto.ETH,
      fiatCurrency: AcceptedFiat.USD,
      amount: 1,
      time: new Date(),
      is_archived: false,
    });
  }

  const manualWalletStringId = `mcp-smoke-manual-${Date.now()}`;
  const manualWallet = await BaseWalletModel.create({
    userId: user.id,
    name: 'MCP Smoke Manual Wallet',
    address: 'manual-mcp-smoke-address',
    type: WalletType.ETHEREUM,
    origin_type: WalletOriginType.MANUAL,
    manual_wallet_id: manualWalletStringId,
    status_transfer_company: false,
    is_deleted: false,
  });
  for (let i = 1; i <= MANUAL_TX_COUNT; i++) {
    await createTx(user.id, manualWallet.id, i, 'manual-mcp-smoke-address', manualWalletStringId);
  }

  const onChainWallet = await BaseWalletModel.create({
    userId: user.id,
    name: 'MCP Smoke On-Chain Wallet',
    address: '0xMCPSMOKEONCHAINADDRESS00000000000000001',
    type: WalletType.ETHEREUM,
    origin_type: WalletOriginType.WALLET,
    status_transfer_company: false,
    is_deleted: false,
  });
  for (let i = 1; i <= ON_CHAIN_TX_COUNT; i++) {
    await createTx(user.id, onChainWallet.id, i, '0xMCPSMOKEONCHAINADDRESS00000000000000001');
  }

  const from = '2020-01-01';
  const to = '2030-12-31';
  const fixture = {
    baseUrl: `http://127.0.0.1:${LISTEN_PORT}/api`,
    token: authToken,
    userId: user.id,
    jwtSecret: process.env.JWT_SECRET || '1234',
    manualWalletId: manualWallet.id,
    onChainWalletId: onChainWallet.id,
    manualTxCount: MANUAL_TX_COUNT,
    onChainTxCount: ON_CHAIN_TX_COUNT,
    from,
    to,
    database: process.env.DB_DATABASE,
  };

  await new Promise((resolve, reject) => {
    const server = app.listen(LISTEN_PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });

  fs.writeFileSync(READY_PATH, JSON.stringify(fixture, null, 2));
  // Single stdout line the parent smoke test parses.
  console.log(`===SMOKE_READY===${JSON.stringify(fixture)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
