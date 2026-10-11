#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This program is intentionally prepare-only. It has no signer and never calls
// an execution endpoint. Its only network operation is a checked simulation.

const WORKTREE = process.env.SOULIDITY_V8_WORKTREE
  || '/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-drop-legacy';
const PACKAGE_PATH = join(WORKTREE, 'move/animacraft');
const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));

const NETWORK = 'mainnet';
const RPC = 'https://fullnode.mainnet.sui.io:443';
const CHAIN_ID = '35834a8a';
const SENDER = '0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f';
const UPGRADE_CAP_ID = '0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520';
const CURRENT_PACKAGE_ID = '0x3863f5c037d6f8827e0e2401eebb6d0f91ff95f394f5f1c9376a3f4c87b6ce84';
const UPGRADE_POLICY = 0;
const GAS_PRICE = 100n;
const GAS_BUDGET = 1_500_000_000n;

const EXPECTED_SOURCE_COMMIT = '59cae42a8602f54a7b7902aee77971a1dff8a270';
const EXPECTED_SOURCE_TREE = '794b18902c5d758889baf80431a3f99f59e4a8aa';
const EXPECTED_PACKAGE_DIGEST_HEX = '0556ea9eaa771f0574388e0ba7fd747c33503aa4484cc859e26999a977626bb4';

const sdkPath = (subpath) => pathToFileURL(join(
  WORKTREE,
  'node_modules/@mysten/sui/dist',
  subpath,
)).href;

const [{ SuiGrpcClient }, { Transaction, TransactionDataBuilder }, { toBase58 }] = await Promise.all([
  import(sdkPath('grpc/index.mjs')),
  import(sdkPath('transactions/index.mjs')),
  import(sdkPath('utils/index.mjs')),
]);

function command(program, args) {
  return execFileSync(program, args, {
    cwd: WORKTREE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'bigint') return entry.toString();
    if (entry instanceof Uint8Array) return Array.from(entry);
    return entry;
  }));
}

const sourceCommit = command('git', ['rev-parse', 'HEAD']);
const sourceTree = command('git', ['rev-parse', 'HEAD^{tree}']);
const sourceStatus = command('git', ['status', '--porcelain']);
assertEqual(sourceCommit, EXPECTED_SOURCE_COMMIT, 'source commit');
assertEqual(sourceTree, EXPECTED_SOURCE_TREE, 'source tree');
assertEqual(sourceStatus, '', 'source worktree status');

const build = JSON.parse(command('sui', [
  'move',
  'build',
  '--path',
  PACKAGE_PATH,
  '--dump-bytecode-as-base64',
]));
const packageDigestBytes = Uint8Array.from(build.digest);
const packageDigestHex = Buffer.from(packageDigestBytes).toString('hex');
assertEqual(packageDigestHex, EXPECTED_PACKAGE_DIGEST_HEX, 'package digest');

const transaction = new Transaction();
transaction.setSender(SENDER);
transaction.setGasOwner(SENDER);
transaction.setGasPayment([]);
transaction.setGasPrice(GAS_PRICE);
transaction.setGasBudget(GAS_BUDGET);

const upgradeCap = transaction.object(UPGRADE_CAP_ID);
const upgradeTicket = transaction.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [
    upgradeCap,
    transaction.pure.u8(UPGRADE_POLICY),
    transaction.pure.vector('u8', Array.from(packageDigestBytes)),
  ],
});
const upgradeReceipt = transaction.upgrade({
  modules: build.modules,
  dependencies: build.dependencies,
  package: CURRENT_PACKAGE_ID,
  ticket: upgradeTicket,
});
transaction.moveCall({
  target: '0x2::package::commit_upgrade',
  arguments: [upgradeCap, upgradeReceipt],
});

const client = new SuiGrpcClient({ network: NETWORK, baseUrl: RPC });
const transactionBytes = await transaction.build({ client });
const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
const transactionData = transaction.getData();
if (transactionData.gasData.payment?.length !== 0) {
  throw new Error('address-balance gas requires an exact empty gas payment vector');
}

const simulation = await client.core.simulateTransaction({
  transaction: transactionBytes,
  checksEnabled: true,
  include: {
    effects: true,
    events: true,
    balanceChanges: true,
    objectTypes: true,
    transaction: true,
  },
});
if (simulation.$kind !== 'Transaction') {
  throw new Error(`simulation failed: ${JSON.stringify(jsonValue(simulation), null, 2)}`);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const unsignedBase64 = Buffer.from(transactionBytes).toString('base64');
const unsignedPath = join(OUTPUT_DIR, 'mainnet-upgrade-v8-unsigned.b64');
const manifestPath = join(OUTPUT_DIR, 'mainnet-upgrade-v8-unsigned-manifest.json');
writeFileSync(unsignedPath, `${unsignedBase64}\n`, { encoding: 'utf8', mode: 0o600 });

const manifest = {
  schemaVersion: 'soulidity.animacraft-expansion-pack-v8-upgrade-unsigned.v1',
  generatedAtUtc: new Date().toISOString(),
  safety: {
    signed: false,
    executed: false,
    simulationOnly: true,
  },
  network: {
    name: NETWORK,
    rpc: RPC,
    chainIdentifier: CHAIN_ID,
  },
  source: {
    worktree: WORKTREE,
    commit: sourceCommit,
    tree: sourceTree,
    clean: true,
  },
  package: {
    currentPackageId: CURRENT_PACKAGE_ID,
    upgradeCapabilityId: UPGRADE_CAP_ID,
    upgradePolicy: UPGRADE_POLICY,
    digestBytes: Array.from(packageDigestBytes),
    digestHex: `0x${packageDigestHex}`,
    digestBase58: toBase58(packageDigestBytes),
    moduleCount: build.modules.length,
    dependencies: build.dependencies,
  },
  transaction: {
    sender: SENDER,
    gasOwner: SENDER,
    gasPayment: [],
    gasPriceMist: GAS_PRICE.toString(),
    gasBudgetMist: GAS_BUDGET.toString(),
    digest: transactionDigest,
    bytesLength: transactionBytes.length,
    bytesSha256: createHash('sha256').update(transactionBytes).digest('hex'),
    unsignedBytesFile: unsignedPath,
  },
  simulation: jsonValue(simulation),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});

console.log(JSON.stringify({
  manifestPath,
  unsignedPath,
  transactionDigest,
  transactionBytesLength: transactionBytes.length,
  transactionBytesSha256: manifest.transaction.bytesSha256,
  packageDigestBase58: manifest.package.digestBase58,
  simulation: manifest.simulation,
}, null, 2));
