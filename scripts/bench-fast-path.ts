#!/usr/bin/env tsx
/**
 * scripts/bench-fast-path.ts
 *
 * Build PTB2-shaped fast-path Transactions for N ∈ {1, 3, 6, 12, 20}
 * against the currently published Soulidity package, run
 * `dryRunTransactionBlock`, and record:
 *   - Serialised TX byte length
 *   - dryRun.effects.gasUsed.computationCost + storageCost (in MIST)
 *
 * Output is appended to `docs/benchmarks/fast-path-<network>-<timestamp>.md`
 * so the values used to choose `BYTES_CAP` and `GAS_CAP_MIST` are reproducible.
 *
 * Usage:
 *   NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/bench-fast-path.ts
 *   NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/bench-fast-path.ts
 *
 * The bench does not sign — it only builds + dryRuns. It still requires:
 *   - A funded sender address (env BENCH_SENDER_ADDRESS) to anchor the
 *     gas object selection.
 *   - On-chain MarketConfig / KioskRegistry / SoulTransferPolicy /
 *     SoulCollection / personal kiosk objects matching the deployment
 *     manifest. The script reads these from
 *     web/lib/soulidity/deployment-manifest.json for the active network.
 *   - BENCH_BLOB_IDS must contain at least 20 registered Walrus Blob object
 *     ids, comma-separated, so each synthetic soul references a distinct blob.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import { buildCollectionFastPathPtb2Tx } from '@web/lib/soulidity/tx/publish'

interface DeploymentManifest {
  [network: string]: {
    packageId: string
    marketConfigId: string
    kioskRegistryId: string
    soulTransferPolicyId: string
    collectionTransferPolicyId: string
    paymentCoinType: string
  }
}

interface BenchInputs {
  network: 'testnet' | 'mainnet'
  senderAddress: string
  collectionOnChainId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  protectedBlobObjectIds: string[]
  /** Structural stand-in for `attachCertifyCalls(tx)`. This bench records
   *  PTB2 minus Walrus cert calls only; release cap approval must use the
   *  smoke harness rows, which execute real with-cert PTBs. */
  attachCertifyCalls: (tx: Transaction) => void
}

function loadManifest(): DeploymentManifest {
  const path = resolve(process.cwd(), 'web/lib/soulidity/deployment-manifest.json')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const text = require('node:fs').readFileSync(path, 'utf8') as string
  return JSON.parse(text) as DeploymentManifest
}

async function buildFastPathTransaction(N: number, ins: BenchInputs): Promise<Transaction> {
  return buildCollectionFastPathPtb2Tx({
    collectionOnChainId: ins.collectionOnChainId,
    currentKioskId: ins.currentKioskId,
    currentKioskCapOnChainId: ins.currentKioskCapOnChainId,
    souls: Array.from({ length: N }, (_, i) => ({
      name: `Bench Soul ${i + 1}`,
      description: 'bench',
      imageUrl: 'https://example.com/bench.png',
      protectedBlobObjectId: ins.protectedBlobObjectIds[i],
      foundingMemoryBlobObjectId: null,
      skillsBlobObjectId: null,
      initialSkillName: null,
      skillsVisibility: 'private',
      creatorRoyaltyBps: 500,
    })),
    attachCertifyCalls: ins.attachCertifyCalls,
  })
}

async function benchOne(N: number, ins: BenchInputs, suiClient: SuiJsonRpcClient) {
  const tx = await buildFastPathTransaction(N, ins)
  tx.setSender(ins.senderAddress)
  let bytes: Uint8Array
  try {
    bytes = await tx.build({ client: suiClient as never, onlyTransactionKind: false })
  } catch (e) {
    return {
      N,
      bytes: null,
      gasMist: null,
      buildError: e instanceof Error ? e.message : String(e),
    }
  }
  const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
  const status = dryRun.effects.status.status
  const gas = Number(dryRun.effects.gasUsed.computationCost) + Number(dryRun.effects.gasUsed.storageCost)
  return {
    N,
    bytes: bytes.length,
    gasMist: gas,
    status,
    dryRunError: dryRun.effects.status.error ?? null,
  }
}

async function main() {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const senderAddress = process.env.BENCH_SENDER_ADDRESS
  const collectionOnChainId = process.env.BENCH_COLLECTION_ID
  const currentKioskId = process.env.BENCH_KIOSK_ID
  const currentKioskCapOnChainId = process.env.BENCH_KIOSK_CAP_ID
  const protectedBlobObjectIds = (process.env.BENCH_BLOB_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!senderAddress || !collectionOnChainId || !currentKioskId || !currentKioskCapOnChainId || protectedBlobObjectIds.length < 20) {
    console.error([
      'Required env vars are missing. Set:',
      '  BENCH_SENDER_ADDRESS=<sui address>',
      '  BENCH_COLLECTION_ID=<existing SoulCollection id>',
      '  BENCH_KIOSK_ID=<sender personal kiosk id>',
      '  BENCH_KIOSK_CAP_ID=<sender personal kiosk cap id>',
      '  BENCH_BLOB_IDS=<20 comma-separated registered Walrus Blob object ids>',
      '',
      'The collection/kiosk/blob can be on the smoke harness wallet from',
      'scripts/smoke-soulidity.ts; the bench builds the same fast-path',
      'PTB2 shape but does not sign or settle.',
    ].join('\n'))
    process.exit(1)
  }

  const manifest = loadManifest()
  const networkManifest = manifest[network]
  if (!networkManifest) {
    console.error(`No deployment-manifest entry for network "${network}"`)
    process.exit(1)
  }
  // Set the env vars the builder reads via getRequiredSoulidityEnv so the
  // bench produces a TX shaped against the live deployment.
  process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = networkManifest.packageId
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = networkManifest.marketConfigId
  process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = networkManifest.kioskRegistryId
  process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = networkManifest.soulTransferPolicyId
  process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = networkManifest.collectionTransferPolicyId

  const suiClient = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  })

  const ins: BenchInputs = {
    network,
    senderAddress,
    collectionOnChainId,
    currentKioskId,
    currentKioskCapOnChainId,
    protectedBlobObjectIds,
    // We cannot attach real certifyBlob calls without the Walrus certificate
    // material from upload completion. This is a structural lower bound only;
    // the smoke harness produces with-cert numbers in docs/benchmarks/.
    attachCertifyCalls: () => {},
  }

  const Ns = [1, 3, 6, 12, 20]
  const rows: Awaited<ReturnType<typeof benchOne>>[] = []
  for (const N of Ns) {
    process.stderr.write(`bench N=${N}... `)
    try {
      const row = await benchOne(N, ins, suiClient)
      rows.push(row)
      process.stderr.write(`bytes=${row.bytes ?? 'n/a'} gas=${row.gasMist ?? 'n/a'}\n`)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      rows.push({ N, bytes: null, gasMist: null, dryRunError: err, status: undefined } as never)
      process.stderr.write(`FAILED: ${err}\n`)
    }
  }

  const benchDir = resolve(process.cwd(), 'docs/benchmarks')
  mkdirSync(benchDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(benchDir, `fast-path-${network}-${stamp}.md`)

  const lines: string[] = []
  lines.push(`# Soulidity 2-signature fast-path bench (${network})`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Package: \`${networkManifest.packageId}\``)
  lines.push('')
  lines.push('Note: this bench skips Walrus certifyBlob calls (they require a')
  lines.push('live WalrusClient + registered blob set). The smoke harness emits')
  lines.push('with-cert numbers in the same directory under the same stamp.')
  lines.push('')
  lines.push('| N | bytes | gas (MIST) | dry-run status | error |')
  lines.push('|---|------:|-----------:|----------------|-------|')
  for (const row of rows) {
    const r = row as Record<string, unknown>
    lines.push(`| ${r.N} | ${r.bytes ?? '—'} | ${r.gasMist ?? '—'} | ${r.status ?? '—'} | ${r.dryRunError ?? r.buildError ?? ''} |`)
  }
  lines.push('')
  lines.push('Defaults to compare against smoke with-cert numbers:')
  lines.push('- `NEXT_PUBLIC_SOULIDITY_FAST_PATH_BYTES_CAP=96000` (75% of 128 KB)')
  lines.push('- `NEXT_PUBLIC_SOULIDITY_FAST_PATH_GAS_CAP_MIST=5_000_000_000` (5 SUI)')

  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
