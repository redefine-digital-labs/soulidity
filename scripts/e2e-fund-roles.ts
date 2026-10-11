/**
 * W1.2 — E2E mainnet role funder.
 *
 * Single PTB signed by MAINNET_DEPLOYER_PRIV_KEY that tops up SUI / WAL /
 * USDC for the 5 E2E role addresses up to the targets in the test plan
 * (`docs/plans/e2e-test-plan.md` Phase -1.3 table). Fully idempotent:
 * any role already at or above target is skipped.
 *
 * Defaults to dry-run. Pass `--execute` to actually send the TX.
 *
 * Hard caps (refuses to send if any per-recipient diff or total spend
 * exceeds these):
 *   - per-recipient SUI: ≤ 1 SUI  (1_000_000_000 atomic)
 *   - per-recipient WAL: ≤ 120_000_000 atomic
 *   - per-recipient USDC: ≤ 10_000_000 atomic (10 USDC)
 *   - total SUI sent in PTB: ≤ 5 SUI
 *   - total WAL: ≤ 150_000_000 atomic
 *   - total USDC: ≤ 30_000_000 atomic
 *
 * These caps are the safety belt — not a tuning knob. If the targets in
 * the plan ever rise past these, edit the plan and this script together.
 *
 * Reads (env):
 *   NEXT_PUBLIC_SUI_NETWORK=mainnet (required; aborts otherwise)
 *   MAINNET_DEPLOYER_PRIV_KEY (master keypair, signs the funding PTB)
 *   E2E_SELLER_PRIVATE_KEY / E2E_BUYER_PRIVATE_KEY /
 *   E2E_AGENT_ALPHA_PRIVATE_KEY / E2E_AGENT_BETA_PRIVATE_KEY /
 *   E2E_DEV_PRIVATE_KEY (role keypairs — recipient addresses derived here)
 *   MAINNET_WAL_COIN_TYPE (WAL coin type, e.g. 0x...::wal::WAL — aborts
 *     if missing or still a `<...>` placeholder)
 *
 * Reads (manifest):
 *   packages/soulidity-sdk/src/deployment-manifest.json -> mainnet.paymentCoinType
 *
 * Usage:
 *   npx tsx scripts/e2e-bootstrap-keys.ts          # ensure role keys exist
 *   npx tsx scripts/e2e-fund-roles.ts              # dry-run
 *   npx tsx scripts/e2e-fund-roles.ts --execute    # actually send PTB
 */
import './lib/dotenv'
import { loadEnvFile } from './lib/dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import { Transaction } from '@mysten/sui/transactions'

type SuiClientLike = SuiJsonRpcClient
type CoinPageEntry = { coinObjectId: string; balance: string }

import { decodeEd25519SecretKey, loadKeypairFromEnv } from './lib/keypair'

// Dotenv loader pulls .env + .env.local; .env.e2e is the canonical E2E
// source-of-truth, so layer it on top here. The loadEnvFile helper does
// not override CLI env vars.
loadEnvFile('.env.e2e')

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MANIFEST_PATH = resolve(REPO_ROOT, 'packages/soulidity-sdk/src/deployment-manifest.json')

const SUI_DECIMALS = 9
const SUI = (n: number) => BigInt(Math.round(n * 10 ** SUI_DECIMALS))

interface RoleTarget {
  name: string
  envName: string
  sui: bigint
  wal: bigint
  usdc: bigint
}

const ROLE_TARGETS: RoleTarget[] = [
  {
    name: 'Seller',
    envName: 'E2E_SELLER_PRIVATE_KEY',
    sui: SUI(0.5),
    wal: 5_000_000n,
    usdc: 1_000_000n,
  },
  {
    name: 'Buyer',
    envName: 'E2E_BUYER_PRIVATE_KEY',
    sui: SUI(0.5),
    wal: 100_000_000n,
    usdc: 5_000_000n,
  },
  {
    name: 'Agent Alpha',
    envName: 'E2E_AGENT_ALPHA_PRIVATE_KEY',
    sui: SUI(0.3),
    wal: 0n,
    usdc: 5_000_000n,
  },
  {
    name: 'Agent Beta',
    envName: 'E2E_AGENT_BETA_PRIVATE_KEY',
    sui: SUI(0.1),
    wal: 0n,
    usdc: 0n,
  },
  {
    name: 'Dev',
    envName: 'E2E_DEV_PRIVATE_KEY',
    sui: SUI(0.3),
    wal: 5_000_000n,
    usdc: 0n,
  },
]

// Hard safety caps. These are intentionally generous vs the plan's actual
// numbers (the plan asks for ≤ 0.5 SUI, ≤ 100M WAL, ≤ 5M USDC per role) so
// that any single transient bug or env tweak that pushes a recipient past the
// Phase 8 buffer still trips this guard.
const PER_RECIPIENT_CAP_SUI = SUI(1)
const PER_RECIPIENT_CAP_WAL = 120_000_000n
const PER_RECIPIENT_CAP_USDC = 10_000_000n
const TOTAL_CAP_SUI = SUI(5)
const TOTAL_CAP_WAL = 150_000_000n
const TOTAL_CAP_USDC = 30_000_000n

function abort(message: string): never {
  console.error(`Fatal: ${message}`)
  process.exit(1)
}

function readUsdcCoinType(): string {
  if (!existsSync(MANIFEST_PATH)) {
    abort(`Manifest not found at ${MANIFEST_PATH}`)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<
    string,
    { paymentCoinType?: string }
  >
  const coinType = manifest.mainnet?.paymentCoinType?.trim()
  if (!coinType) abort('manifest.mainnet.paymentCoinType is missing')
  return coinType
}

function readWalCoinType(): string {
  const raw = process.env.MAINNET_WAL_COIN_TYPE?.trim()
  if (!raw) {
    abort(
      'MAINNET_WAL_COIN_TYPE is not set. Run `walrus info --context mainnet` and write the WAL coin type (`0x…::wal::WAL`) into .env.e2e before re-running.',
    )
  }
  if (raw.startsWith('<') || !raw.includes('::')) {
    abort(`MAINNET_WAL_COIN_TYPE looks like a placeholder ("${raw}"). Set the real coin type before re-running.`)
  }
  return raw
}

async function getCoinBalance(
  client: SuiClientLike,
  owner: string,
  coinType: string,
): Promise<bigint> {
  const balance = await client.getBalance({ owner, coinType })
  return BigInt(balance.totalBalance)
}

function diffBigInt(target: bigint, current: bigint): bigint {
  const d = target - current
  return d > 0n ? d : 0n
}

interface RecipientPlan {
  name: string
  address: string
  current: { sui: bigint; wal: bigint; usdc: bigint }
  target: { sui: bigint; wal: bigint; usdc: bigint }
  diff: { sui: bigint; wal: bigint; usdc: bigint }
}

async function main() {
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim()
  if (network !== 'mainnet') {
    abort(`NEXT_PUBLIC_SUI_NETWORK must be "mainnet", got "${network ?? '(unset)'}"`)
  }

  const masterKey = process.env.MAINNET_DEPLOYER_PRIV_KEY?.trim()
  if (!masterKey) abort('MAINNET_DEPLOYER_PRIV_KEY is not set')
  const masterKeypair = decodeEd25519SecretKey(masterKey, 'MAINNET_DEPLOYER_PRIV_KEY')
  const masterAddress = masterKeypair.toSuiAddress()

  const usdcType = readUsdcCoinType()
  const walType = readWalCoinType()
  const SUI_TYPE = '0x2::sui::SUI'

  const client = createSuiGrpcCompatClient('mainnet')

  // Resolve recipients (and abort if any role key is missing — fail closed).
  const recipients: RecipientPlan[] = []
  for (const role of ROLE_TARGETS) {
    let kp
    try {
      kp = loadKeypairFromEnv(role.envName)
    } catch (err) {
      abort(`${role.name}: ${(err as Error).message}. Run scripts/e2e-bootstrap-keys.ts first.`)
    }
    const address = kp.toSuiAddress()
    const [sui, wal, usdc] = await Promise.all([
      getCoinBalance(client, address, SUI_TYPE),
      role.wal > 0n ? getCoinBalance(client, address, walType) : Promise.resolve(0n),
      role.usdc > 0n ? getCoinBalance(client, address, usdcType) : Promise.resolve(0n),
    ])
    recipients.push({
      name: role.name,
      address,
      current: { sui, wal, usdc },
      target: { sui: role.sui, wal: role.wal, usdc: role.usdc },
      diff: {
        sui: diffBigInt(role.sui, sui),
        wal: diffBigInt(role.wal, wal),
        usdc: diffBigInt(role.usdc, usdc),
      },
    })
  }

  // Per-recipient cap check.
  for (const r of recipients) {
    if (r.diff.sui > PER_RECIPIENT_CAP_SUI) {
      abort(
        `${r.name}: SUI top-up ${r.diff.sui} exceeds per-recipient cap ${PER_RECIPIENT_CAP_SUI}. Either lower the target in ROLE_TARGETS or audit upstream.`,
      )
    }
    if (r.diff.wal > PER_RECIPIENT_CAP_WAL) {
      abort(`${r.name}: WAL top-up ${r.diff.wal} exceeds per-recipient cap ${PER_RECIPIENT_CAP_WAL}.`)
    }
    if (r.diff.usdc > PER_RECIPIENT_CAP_USDC) {
      abort(`${r.name}: USDC top-up ${r.diff.usdc} exceeds per-recipient cap ${PER_RECIPIENT_CAP_USDC}.`)
    }
  }

  const totals = recipients.reduce(
    (acc, r) => ({
      sui: acc.sui + r.diff.sui,
      wal: acc.wal + r.diff.wal,
      usdc: acc.usdc + r.diff.usdc,
    }),
    { sui: 0n, wal: 0n, usdc: 0n },
  )

  if (totals.sui > TOTAL_CAP_SUI) {
    abort(`Total SUI to send ${totals.sui} exceeds TX cap ${TOTAL_CAP_SUI}.`)
  }
  if (totals.wal > TOTAL_CAP_WAL) {
    abort(`Total WAL to send ${totals.wal} exceeds TX cap ${TOTAL_CAP_WAL}.`)
  }
  if (totals.usdc > TOTAL_CAP_USDC) {
    abort(`Total USDC to send ${totals.usdc} exceeds TX cap ${TOTAL_CAP_USDC}.`)
  }

  // Master balances (for sanity logging).
  const [masterSui, masterWal, masterUsdc] = await Promise.all([
    getCoinBalance(client, masterAddress, SUI_TYPE),
    getCoinBalance(client, masterAddress, walType),
    getCoinBalance(client, masterAddress, usdcType),
  ])

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('E2E mainnet role funder')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Network:       mainnet`)
  console.log(`Funder:        ${masterAddress}`)
  console.log(`  SUI:  ${masterSui}`)
  console.log(`  WAL:  ${masterWal}  (type: ${walType})`)
  console.log(`  USDC: ${masterUsdc}  (type: ${usdcType})`)
  console.log()
  console.log('Recipients:')
  for (const r of recipients) {
    const status = r.diff.sui === 0n && r.diff.wal === 0n && r.diff.usdc === 0n ? '✓ at target' : '· top-up'
    console.log(`  ${r.name.padEnd(12)} ${r.address}   ${status}`)
    console.log(
      `     SUI:  current=${r.current.sui}  target=${r.target.sui}  diff=${r.diff.sui}`,
    )
    if (r.target.wal > 0n) {
      console.log(`     WAL:  current=${r.current.wal}  target=${r.target.wal}  diff=${r.diff.wal}`)
    }
    if (r.target.usdc > 0n) {
      console.log(
        `     USDC: current=${r.current.usdc}  target=${r.target.usdc}  diff=${r.diff.usdc}`,
      )
    }
  }
  console.log()
  console.log(`Totals to send: SUI=${totals.sui}  WAL=${totals.wal}  USDC=${totals.usdc}`)
  console.log()

  if (totals.sui === 0n && totals.wal === 0n && totals.usdc === 0n) {
    console.log('✓ All roles already at target. No TX needed.')
    return
  }

  // Master sufficiency check (treat with a small buffer for gas).
  const SUI_GAS_BUFFER = SUI(0.1)
  if (masterSui < totals.sui + SUI_GAS_BUFFER) {
    abort(`Master SUI ${masterSui} < required ${totals.sui + SUI_GAS_BUFFER} (incl ${SUI_GAS_BUFFER} gas buffer).`)
  }
  if (totals.wal > 0n && masterWal < totals.wal) {
    abort(`Master WAL ${masterWal} < required ${totals.wal}.`)
  }
  if (totals.usdc > 0n && masterUsdc < totals.usdc) {
    abort(`Master USDC ${masterUsdc} < required ${totals.usdc}.`)
  }

  // Build PTB.
  const tx = new Transaction()

  // SUI: split from gas coin.
  for (const r of recipients) {
    if (r.diff.sui === 0n) continue
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(r.diff.sui)])
    tx.transferObjects([coin], tx.pure.address(r.address))
  }

  // WAL: select coins owned by master, merge if multiple, then split + transfer per recipient.
  const walRecipients = recipients.filter((r) => r.diff.wal > 0n)
  if (walRecipients.length > 0) {
    const walCoins = await client.getCoins({ owner: masterAddress, coinType: walType, limit: 50 })
    if (walCoins.data.length === 0) {
      abort(`Master holds no ${walType} coins.`)
    }
    const [primary, ...rest] = walCoins.data as CoinPageEntry[]
    const primaryArg = tx.object(primary.coinObjectId)
    if (rest.length > 0) {
      tx.mergeCoins(primaryArg, rest.map((c: CoinPageEntry) => tx.object(c.coinObjectId)))
    }
    for (const r of walRecipients) {
      const [coin] = tx.splitCoins(primaryArg, [tx.pure.u64(r.diff.wal)])
      tx.transferObjects([coin], tx.pure.address(r.address))
    }
  }

  // USDC: same pattern.
  const usdcRecipients = recipients.filter((r) => r.diff.usdc > 0n)
  if (usdcRecipients.length > 0) {
    const usdcCoins = await client.getCoins({ owner: masterAddress, coinType: usdcType, limit: 50 })
    if (usdcCoins.data.length === 0) {
      abort(`Master holds no ${usdcType} coins.`)
    }
    const [primary, ...rest] = usdcCoins.data as CoinPageEntry[]
    const primaryArg = tx.object(primary.coinObjectId)
    if (rest.length > 0) {
      tx.mergeCoins(primaryArg, rest.map((c: CoinPageEntry) => tx.object(c.coinObjectId)))
    }
    for (const r of usdcRecipients) {
      const [coin] = tx.splitCoins(primaryArg, [tx.pure.u64(r.diff.usdc)])
      tx.transferObjects([coin], tx.pure.address(r.address))
    }
  }

  tx.setSender(masterAddress)
  const txBytes = await tx.build({ client })

  // Always run dry-run first; print and gate execution behind --execute.
  const dryRun = await client.dryRunTransactionBlock({ transactionBlock: txBytes })
  if (dryRun.effects.status.status !== 'success') {
    abort(`Dry-run failed: ${JSON.stringify(dryRun.effects.status, null, 2)}`)
  }
  const gasUsed = dryRun.effects.gasUsed
  console.log('Dry-run OK.')
  console.log(`  computationCost:   ${gasUsed.computationCost}`)
  console.log(`  storageCost:       ${gasUsed.storageCost}`)
  console.log(`  storageRebate:     ${gasUsed.storageRebate}`)
  console.log()

  const shouldExecute = process.argv.includes('--execute')
  if (!shouldExecute) {
    console.log('Dry-run complete. Re-run with --execute to actually send the TX.')
    return
  }

  console.log('Executing PTB on mainnet…')
  const { signature } = await masterKeypair.signTransaction(txBytes)
  const result = await client.executeTransactionBlock({
    transactionBlock: Buffer.from(txBytes).toString('base64'),
    signature,
    options: { showEffects: true },
  })
  await client.waitForTransaction({ digest: result.digest }).catch(() => undefined)

  console.log(`TX digest: ${result.digest}`)
  console.log(`Status:    ${JSON.stringify(result.effects?.status)}`)

  // Re-query and verify each recipient hit target.
  console.log('\nPost-TX balances:')
  let allOk = true
  for (const r of recipients) {
    const [sui, wal, usdc] = await Promise.all([
      getCoinBalance(client, r.address, SUI_TYPE),
      r.target.wal > 0n ? getCoinBalance(client, r.address, walType) : Promise.resolve(0n),
      r.target.usdc > 0n ? getCoinBalance(client, r.address, usdcType) : Promise.resolve(0n),
    ])
    const okSui = sui >= r.target.sui
    const okWal = r.target.wal === 0n || wal >= r.target.wal
    const okUsdc = r.target.usdc === 0n || usdc >= r.target.usdc
    const ok = okSui && okWal && okUsdc
    if (!ok) allOk = false
    console.log(
      `  ${r.name.padEnd(12)} ${r.address}  SUI=${sui}${okSui ? '' : ' ✗'}  WAL=${wal}${okWal ? '' : ' ✗'}  USDC=${usdc}${okUsdc ? '' : ' ✗'}`,
    )
  }
  if (!allOk) {
    abort('At least one recipient is below target after the TX. Inspect the TX effects.')
  }
  console.log('\n✓ All roles funded to target.')
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
