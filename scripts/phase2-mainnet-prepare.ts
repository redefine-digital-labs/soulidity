#!/usr/bin/env tsx
/**
 * scripts/phase2-mainnet-prepare.ts
 *
 * Phase 2 mainnet smoke test — preparation step.
 *
 * What this does (idempotent):
 *   1. Reads MAINNET_DEPLOYER_PRIV_KEY from .env.local.
 *   2. Imports the key into `sui keytool` if not already present.
 *   3. Switches sui client active env to mainnet.
 *   4. Switches sui client active address to the test wallet.
 *   5. Verifies wallet has enough SUI / WAL.
 *   6. Generates 8 tiny placeholder fixture files (≤200 bytes each):
 *        - 4 for the personal Soul (soul / memory / skill / sprite).
 *        - 4 for the collection's first Soul (same shape).
 *      All are placeholders per user spec — protocol verification only,
 *      no real Soul content is uploaded.
 *   7. Uploads all 8 to mainnet Walrus via `walrus json store`.
 *   8. Parses out 8 Blob object IDs and writes them to .env.local as
 *      PHASE2_BLOB_OBJECT_IDS=<id1>,<id2>,...,<id8>.
 *
 * Cost: ≤0.4 SUI gas + ≤0.5 WAL storage.
 *
 * Usage:
 *   npm run phase2:prepare           # dry-run preview
 *   npm run phase2:prepare -- --apply # do everything
 *
 * Prerequisites:
 *   - walrus CLI installed (multi-context config with `mainnet` context).
 *   - MAINNET_DEPLOYER_PRIV_KEY set in .env.local (bech32/base64/hex).
 *   - The test wallet must hold ≥6 SUI and ≥1 WAL on mainnet.
 */

import './lib/dotenv'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import { decodeEd25519SecretKey } from './lib/keypair'

// ── Config ────────────────────────────────────────────────────────────

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envLocalPath = resolve(repoRoot, '.env.local')

const MIN_SUI_MIST = 6_000_000_000n // 6 SUI
const MIN_WAL_FROST = 500_000_000n // 0.5 WAL (1 WAL = 1e9 FROST)

const FIXTURE_LABELS = [
  'soul1-doc',
  'soul1-memory',
  'soul1-skill',
  'soul1-sprite',
  'soul2-doc',
  'soul2-memory',
  'soul2-skill',
  'soul2-sprite',
] as const

// ── CLI args ──────────────────────────────────────────────────────────

interface Args {
  apply: boolean
}

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply')
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('phase2-mainnet-prepare.ts — see file header for usage')
    process.exit(0)
  }
  return { apply }
}

const args = parseArgs(process.argv.slice(2))

// ── Helpers ───────────────────────────────────────────────────────────

function exec(cmd: string, cmdArgs: string[]): string {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function execAllowFail(cmd: string, cmdArgs: string[]): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { stdout: stdout.trim(), stderr: '', ok: true }
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      stdout: err.stdout?.toString().trim() ?? '',
      stderr: err.stderr?.toString().trim() ?? '',
      ok: false,
    }
  }
}

function logStep(n: number, msg: string) {
  console.log(`\n━━━ Step ${n}: ${msg} ━━━`)
}

// ── Step 1: load test key ─────────────────────────────────────────────

logStep(1, 'Load MAINNET_DEPLOYER_PRIV_KEY')
const rawKey = process.env.MAINNET_DEPLOYER_PRIV_KEY?.trim()
if (!rawKey) {
  console.error('MAINNET_DEPLOYER_PRIV_KEY missing from .env / .env.local')
  console.error('Add: echo \'MAINNET_DEPLOYER_PRIV_KEY=suiprivkey1...\' >> .env.local')
  process.exit(1)
}
const testKeypair = decodeEd25519SecretKey(rawKey, 'MAINNET_DEPLOYER_PRIV_KEY')
const testAddress = testKeypair.toSuiAddress()
console.log(`derived address: ${testAddress}`)

// ── Step 2: import key into sui keytool (idempotent) ──────────────────

logStep(2, 'Import key into sui keytool')
const keytoolList = exec('sui', ['keytool', 'list', '--json'])
const wallets = JSON.parse(keytoolList) as Array<{ suiAddress: string; alias?: string }>
const alreadyImported = wallets.some((w) => w.suiAddress.toLowerCase() === testAddress.toLowerCase())
if (alreadyImported) {
  console.log(`already in keytool, skipping import`)
} else if (!args.apply) {
  console.log(`[dry-run] would import key for ${testAddress}`)
} else {
  // Pass key as positional arg (NOT through shell — avoids history leak).
  // sui keytool import <input> <key_scheme>
  exec('sui', ['keytool', 'import', rawKey, 'ed25519', '--alias', 'phase2-test-deployer'])
  console.log(`imported as alias 'phase2-test-deployer'`)
}

// ── Step 3: switch sui client to mainnet ──────────────────────────────

logStep(3, 'Switch sui client active env to mainnet')
const activeEnv = exec('sui', ['client', 'active-env']).toLowerCase()
if (activeEnv === 'mainnet') {
  console.log('already on mainnet')
} else if (!args.apply) {
  console.log(`[dry-run] would switch from ${activeEnv} to mainnet`)
} else {
  exec('sui', ['client', 'switch', '--env', 'mainnet'])
  console.log('switched to mainnet')
}

// ── Step 4: switch sui client active address to test wallet ───────────

logStep(4, 'Switch sui client active address')
const activeAddrFull = execAllowFail('sui', ['client', 'active-address'])
const activeAddr = (activeAddrFull.ok ? activeAddrFull.stdout : '').toLowerCase()
if (activeAddr === testAddress.toLowerCase()) {
  console.log('already active')
} else if (!args.apply) {
  console.log(`[dry-run] would switch from ${activeAddr || '(none)'} to ${testAddress}`)
} else {
  exec('sui', ['client', 'switch', '--address', testAddress])
  console.log(`active = ${testAddress}`)
}

// ── Step 5: verify balances ──────────────────────────────────────────

logStep(5, 'Verify SUI / WAL balance on mainnet')
const suiClient = createSuiGrpcCompatClient('mainnet')

if (!args.apply && !alreadyImported) {
  console.log('[dry-run] balance check skipped (key not yet imported, but wallet exists on chain)')
}

const suiBalance = await suiClient.getBalance({ owner: testAddress })
const suiMist = BigInt(suiBalance.totalBalance)
console.log(`SUI: ${suiMist} MIST (${Number(suiMist) / 1e9} SUI)`)
if (suiMist < MIN_SUI_MIST) {
  console.error(`✗ insufficient SUI; need ≥${MIN_SUI_MIST} MIST (6 SUI)`)
  if (args.apply) process.exit(1)
}

const walType = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
const walBalance = await suiClient.getBalance({ owner: testAddress, coinType: walType })
const walFrost = BigInt(walBalance.totalBalance)
console.log(`WAL: ${walFrost} FROST (${Number(walFrost) / 1e9} WAL)`)
if (walFrost < MIN_WAL_FROST) {
  console.error(`✗ insufficient WAL; need ≥${MIN_WAL_FROST} FROST (0.5 WAL)`)
  if (args.apply) process.exit(1)
}

const usdcType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const usdcBalance = await suiClient.getBalance({ owner: testAddress, coinType: usdcType })
const usdcAtomic = BigInt(usdcBalance.totalBalance)
console.log(`USDC: ${usdcAtomic} atomic ($${Number(usdcAtomic) / 1e6})`)
if (usdcAtomic < 5_000_000n) {
  console.warn(`⚠ USDC balance < 5 USDC — §12.4/§12.7/§12.9 buyer-side scenarios will be skipped`)
}

if (!args.apply) {
  console.log('\n[dry-run] No further actions taken. Re-run with --apply to import + upload + write env.')
  process.exit(0)
}

// ── Step 6: generate 8 tiny placeholder fixture files ────────────────

logStep(6, 'Generate 8 placeholder fixtures')
const tmpDir = mkdtempSync(join(tmpdir(), 'phase2-fixtures-'))
const fixturePaths: string[] = []
for (const label of FIXTURE_LABELS) {
  const path = join(tmpDir, `${label}.bin`)
  // 200 bytes of unique content per label (timestamp + label + filler) so
  // each Walrus blob ID is unique. Walrus dedupes identical bytes.
  const content = `phase2-mainnet-smoke ${label} ${new Date().toISOString()}\n${'x'.repeat(150)}`
  writeFileSync(path, content, 'utf8')
  fixturePaths.push(path)
}
console.log(`wrote 8 fixtures to ${tmpDir}`)

// ── Step 7: walrus upload (one at a time so output stays parseable) ──

logStep(7, 'Upload 8 fixtures to mainnet Walrus')
const blobObjectIds: string[] = []
for (let i = 0; i < fixturePaths.length; i++) {
  const path = fixturePaths[i]!
  const label = FIXTURE_LABELS[i]!
  process.stdout.write(`  [${i + 1}/8] ${label} ... `)
  const inputJson = JSON.stringify({
    context: 'mainnet',
    command: { store: { files: [path], epochs: 5 } },
  })
  const result = execAllowFail('walrus', ['json', inputJson])
  if (!result.ok) {
    console.error(`FAILED\n${result.stderr}`)
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(2)
  }
  // Walrus json store output: array of results, each with either
  // `newlyCreated.blobObject.id` or `alreadyCertified.blobId` (no object id).
  // Parse the FIRST line that's valid JSON (logs go to stderr; data to stdout).
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    // The output may have multiple JSON values — grab the last { ... }
    const lastBrace = result.stdout.lastIndexOf('{')
    parsed = lastBrace >= 0 ? JSON.parse(result.stdout.slice(lastBrace)) : null
  }
  const objectId = extractBlobObjectId(parsed)
  if (!objectId) {
    console.error(`FAILED: could not parse blob object id from output`)
    console.error(result.stdout.slice(0, 500))
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(2)
  }
  blobObjectIds.push(objectId)
  console.log(`✓ ${objectId}`)
}

// ── Step 8: write to .env.local ──────────────────────────────────────

logStep(8, 'Persist PHASE2_BLOB_OBJECT_IDS to .env.local')
const blobLine = `PHASE2_BLOB_OBJECT_IDS=${blobObjectIds.join(',')}`
const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, 'utf8') : ''
let updated: string
if (existing.match(/^PHASE2_BLOB_OBJECT_IDS=.*$/m)) {
  updated = existing.replace(/^PHASE2_BLOB_OBJECT_IDS=.*$/m, blobLine)
} else {
  updated = existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + blobLine + '\n'
}
writeFileSync(envLocalPath, updated, 'utf8')
console.log(`wrote to .env.local`)

// Cleanup
rmSync(tmpDir, { recursive: true, force: true })

// ── Summary ──────────────────────────────────────────────────────────

console.log('\n━━━ Done ━━━')
console.log(`test wallet  : ${testAddress}`)
console.log(`SUI / WAL    : ${Number(suiMist) / 1e9} SUI / ${Number(walFrost) / 1e9} WAL`)
console.log(`8 blob IDs   : `)
for (let i = 0; i < blobObjectIds.length; i++) {
  console.log(`  ${FIXTURE_LABELS[i]!.padEnd(14)} ${blobObjectIds[i]}`)
}
console.log(`\nNext:`)
console.log(`  1) (optional) npm run phase2:fund      # if buyer/agent keys set`)
console.log(`  2) NEXT_PUBLIC_SUI_NETWORK=mainnet \\`)
console.log(`       npm run publish:soulidity -- --use-env-key \\`)
console.log(`         --mainnet-priv-key-env=MAINNET_DEPLOYER_PRIV_KEY \\`)
console.log(`         --mainnet-e2e \\`)
console.log(`         --payment-coin-type=${usdcType}`)
console.log(`  3) NEXT_PUBLIC_SUI_NETWORK=mainnet \\`)
console.log(`       TESTNET_DEPLOYER_PRIV_KEY=$MAINNET_DEPLOYER_PRIV_KEY \\`)
console.log(`       npm run smoke:phase2 -- --execute`)

// ── Helpers ───────────────────────────────────────────────────────────

function extractBlobObjectId(parsed: unknown): string | null {
  if (!parsed) return null
  // walrus json store can return either an array (one per file) or a single
  // result. Walk for the first newlyCreated.blobObject.id we find.
  const items = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of items) {
    if (typeof item !== 'object' || item == null) continue
    const o = item as Record<string, unknown>
    const newlyCreated = (o.newlyCreated ?? (o.blobStoreResult as Record<string, unknown> | undefined)?.newlyCreated) as Record<string, unknown> | undefined
    if (newlyCreated) {
      const blobObject = newlyCreated.blobObject as Record<string, unknown> | undefined
      if (blobObject?.id) {
        // id can be { id: "0x..." } or a plain string
        const idField = blobObject.id
        if (typeof idField === 'string') return idField
        if (typeof idField === 'object' && idField !== null) {
          const wrapper = idField as Record<string, unknown>
          if (typeof wrapper.id === 'string') return wrapper.id
        }
      }
    }
    const alreadyCertified = o.alreadyCertified as Record<string, unknown> | undefined
    if (alreadyCertified?.blobObjectId) return String(alreadyCertified.blobObjectId)
  }
  return null
}
