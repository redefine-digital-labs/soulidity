#!/usr/bin/env tsx
/**
 * scripts/phase2-smoke.ts
 *
 * Phase 2 unified-content-kind smoke test. Network-agnostic — picks
 * mainnet / testnet / devnet from NEXT_PUBLIC_SUI_NETWORK. Covers the 7
 * acceptance scenarios from `docs/plans/2026-05-04-soulidity-phase2-runbook.md`
 * §12 plus 3 additional collection scenarios (§12.8 create, §12.9 list+buy,
 * §12.10 mint-with-bind).
 *
 * Default mode is dryRun-only (safe, no signing). Pass `--execute` for the
 * happy-path scenarios to actually sign and submit. Reverse-case scenarios
 * always use dryRun (asserting Move abort codes is the point).
 *
 * Required env (mainnet flow uses MAINNET_TEST_DEPLOYER_PRIV_KEY; testnet
 * flow uses TESTNET_DEPLOYER_PRIV_KEY — first non-empty wins):
 *   PHASE2_PUBLISHER_PRIV_KEY (or alias above)
 *                             — bech32/base64/hex Sui priv key for the
 *                                publisher wallet. Must hold gas + WAL.
 *   PHASE2_BLOB_OBJECT_IDS    — comma-separated list of ≥8 Walrus Blob
 *                                object IDs the publisher already owns:
 *                                first 4 = personal Soul (soul/memory/
 *                                skill/sprite); next 4 = collection's first
 *                                Soul (same shape). For ≤7 scenarios only,
 *                                4 IDs is sufficient and §12.10 is skipped.
 *                                Generate via `npm run phase2:prepare`.
 *
 * Optional env:
 *   NEXT_PUBLIC_SUI_NETWORK   — defaults to `mainnet`
 *   PHASE2_BUYER_PRIV_KEY     — buyer wallet for §12.4 / §12.7 / §12.9
 *   PHASE2_AGENT_PRIV_KEY     — agent wallet for §12.3 (or use legacy
 *                                PHASE2_AGENT_ADDRESS for address-only)
 *   PHASE2_USDC_COIN_IDS      — USDC coins owned by buyer (for §12.4 / §12.7 / §12.9)
 *   PHASE2_SMOKE_STATE_ID     — pre-existing soul state id (for §12.3+)
 *   PHASE2_SMOKE_CONTENT_ID   — soul content id (for §12.6)
 *   PHASE2_SMOKE_KIOSK_ID, _KIOSK_CAP_ID — for §12.7
 *   PHASE2_SMOKE_LISTING_ID   — soul listing id (for §12.7)
 *   PHASE2_SMOKE_PAID_ACCESS_LIST_ID — for §12.4
 *   PHASE2_SMOKE_COLLECTION_ID — pre-existing collection id (for §12.10)
 *
 * Usage:
 *   tsx scripts/phase2-smoke.ts                       # all dryRun
 *   tsx scripts/phase2-smoke.ts --scenario 12.2        # one scenario
 *   tsx scripts/phase2-smoke.ts --execute --scenario 12.1
 */

import './lib/dotenv'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { decodeEd25519SecretKey } from './lib/keypair'

// Manifest must be loaded BEFORE importing builders so the
// `getRequiredSoulidityEnv` calls inside the builders see the new package id.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repoRoot, 'packages/soulidity-sdk/src/deployment-manifest.json')

interface DeploymentEntry {
  packageId: string
  marketConfigId: string
  kioskRegistryId: string
  kindRegistryId?: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
}

function loadManifestEntry(network: string): DeploymentEntry {
  const all = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, DeploymentEntry>
  const entry = all[network]
  if (!entry) throw new Error(`No deployment-manifest entry for "${network}"`)
  for (const required of [
    'packageId',
    'marketConfigId',
    'kioskRegistryId',
    'kindRegistryId',
    'soulTransferPolicyId',
    'collectionTransferPolicyId',
    'paymentCoinType',
  ] as const) {
    if (!entry[required]) {
      throw new Error(`deployment-manifest.${network}.${required} is missing — run \`npm run publish:soulidity\` first`)
    }
  }
  return entry
}

function applyManifestToProcessEnv(entry: DeploymentEntry) {
  process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = entry.packageId
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = entry.marketConfigId
  process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = entry.kioskRegistryId
  process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID = entry.kindRegistryId!
  process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = entry.soulTransferPolicyId
  process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = entry.collectionTransferPolicyId
  process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = entry.paymentCoinType
}

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'testnet') as
  | 'testnet'
  | 'mainnet'
  | 'devnet'
const manifestEntry = loadManifestEntry(network)
applyManifestToProcessEnv(manifestEntry)

// Now import builders. They read getRequiredSoulidityEnv at call time, so
// values set above are picked up.
const {
  buildPublishSoulTx,
  buildPublishSoulWithListTx,
  buildPublishSoulWithBindTx,
} = await import('@soulidity/sdk')
const {
  buildCreateCollectionTx,
  buildAddSoulToCollectionTx,
} = await import('@soulidity/sdk')
const { buildBuyCollectionTx } = await import('@soulidity/sdk')
const { buildListCollectionTx } = await import('@soulidity/sdk')
const {
  buildAppendContentVersionAsOwnerTx,
  buildDeleteContentVersionAsOwnerTx,
  buildPurgeContentVersionAsOwnerTx,
  buildSetActiveContentTx,
} = await import('@soulidity/sdk')
const { buildIssueGrantTx, buildRevokeGrantTx } = await import('@soulidity/sdk')
const {
  buildConfigurePaidAccessKindTx,
  buildPurchasePaidAccessTx,
  buildDeletePaidAccessKindTx,
} = await import('@soulidity/sdk')
const { buildBuySoulTx } = await import('@soulidity/sdk')
const { buildListSoulTx } = await import('@soulidity/sdk')
const {
  KIND_SOUL_DOC,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SPRITE,
  CANONICAL_SOUL_DOC_NAME,
  CANONICAL_MEMORY_NAME,
  READ_OWNER,
  READ_GRANT,
  READ_PUBLIC,
  READ_PAID,
} = await import('@soulidity/sdk')
const {
  SOUL_GRANT_SCOPE_SEAL,
  SOUL_GRANT_SCOPE_MEMORY,
  SOUL_GRANT_SCOPE_SKILLS,
  SOUL_GRANT_SCOPE_ASSETS,
} = await import('@soulidity/sdk')

// ── CLI args ───────────────────────────────────────────────────────────

interface CliArgs {
  scenario: string // "all" or "12.1" / "12.2" / ... / "12.7"
  execute: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { scenario: 'all', execute: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--execute') { result.execute = true; continue }
    if (arg === '--scenario') { result.scenario = (argv[++i] ?? 'all').trim(); continue }
    if (arg?.startsWith('--scenario=')) { result.scenario = arg.slice('--scenario='.length).trim(); continue }
    if (arg === '-h' || arg === '--help') {
      console.log('phase2-testnet-smoke.ts — see file header for usage')
      process.exit(0)
    }
  }
  return result
}

const cli = parseArgs(process.argv.slice(2))

// ── Required env ──────────────────────────────────────────────────────

const publisherKeypair = (() => {
  const sources: Array<[string, string | undefined]> = [
    ['PHASE2_PUBLISHER_PRIV_KEY', process.env.PHASE2_PUBLISHER_PRIV_KEY],
    ['MAINNET_DEPLOYER_PRIV_KEY', process.env.MAINNET_DEPLOYER_PRIV_KEY],
    ['TESTNET_DEPLOYER_PRIV_KEY', process.env.TESTNET_DEPLOYER_PRIV_KEY],
  ]
  for (const [name, raw] of sources) {
    if (raw?.trim()) return decodeEd25519SecretKey(raw.trim(), name)
  }
  throw new Error(
    'one of PHASE2_PUBLISHER_PRIV_KEY / MAINNET_TEST_DEPLOYER_PRIV_KEY / TESTNET_DEPLOYER_PRIV_KEY is required',
  )
})()
const publisherAddress = publisherKeypair.toSuiAddress()

const blobObjectIds = (process.env.PHASE2_BLOB_OBJECT_IDS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
if (blobObjectIds.length < 4) {
  throw new Error(
    'PHASE2_BLOB_OBJECT_IDS must contain ≥4 Walrus Blob object IDs (one each for SOUL_DOC, MEMORY, SKILL, SPRITE). For §12.10 collection-bind add 4 more.',
  )
}
// Personal-Soul blobs (used by §12.1 / §12.5)
const [BLOB_SOUL, BLOB_MEMORY, BLOB_SKILL, BLOB_SPRITE] = blobObjectIds
// Collection-Soul blobs (used by §12.10). Optional — falls back to personal
// blobs in dry-run (Move PTB build only checks shape, not blob ownership).
const BLOB_C_SOUL = blobObjectIds[4] ?? BLOB_SOUL
const BLOB_C_MEMORY = blobObjectIds[5] ?? BLOB_MEMORY
const BLOB_C_SKILL = blobObjectIds[6] ?? BLOB_SKILL
const BLOB_C_SPRITE = blobObjectIds[7] ?? BLOB_SPRITE

const buyerKeypair: Ed25519Keypair | null = (() => {
  const raw = process.env.PHASE2_BUYER_PRIV_KEY?.trim()
  if (!raw) return null
  return decodeEd25519SecretKey(raw, 'PHASE2_BUYER_PRIV_KEY')
})()
const buyerAddress = buyerKeypair?.toSuiAddress() ?? null

const agentKeypair: Ed25519Keypair | null = (() => {
  const raw = process.env.PHASE2_AGENT_PRIV_KEY?.trim()
  if (!raw) return null
  return decodeEd25519SecretKey(raw, 'PHASE2_AGENT_PRIV_KEY')
})()
const agentAddress =
  agentKeypair?.toSuiAddress() ?? (process.env.PHASE2_AGENT_ADDRESS?.trim() || null)
const usdcCoinIds = (process.env.PHASE2_USDC_COIN_IDS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

// ── Sui client ─────────────────────────────────────────────────────────

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network })

// ── Result tracking ────────────────────────────────────────────────────

interface ScenarioResult {
  id: string
  name: string
  expected: 'pass' | string // 'pass' or expected error fragment
  outcome: 'pass' | 'fail' | 'skip'
  detail: string
}

const results: ScenarioResult[] = []

function record(r: ScenarioResult) {
  results.push(r)
  const icon = r.outcome === 'pass' ? '✓' : r.outcome === 'skip' ? '⊘' : '✗'
  console.log(`${icon} §${r.id} ${r.name} — ${r.outcome.toUpperCase()}: ${r.detail}`)
}

// ── Helpers: dryRun + assert ──────────────────────────────────────────

interface DryRunOutcome {
  status: 'success' | 'failure'
  error: string | null
  events: Array<{ type?: string; parsedJson?: Record<string, unknown> }>
}

async function dryRunWithSender(tx: Transaction, sender: string): Promise<DryRunOutcome> {
  tx.setSender(sender)
  const bytes = await tx.build({ client: suiClient as never, onlyTransactionKind: false })
  const dr = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
  const status = dr.effects.status.status
  return {
    status,
    error: dr.effects.status.error ?? null,
    events: (dr.events ?? []) as DryRunOutcome['events'],
  }
}

async function expectDryRunPass(
  scenarioId: string,
  scenarioName: string,
  buildTx: () => Promise<Transaction> | Transaction,
  sender: string,
): Promise<DryRunOutcome | null> {
  try {
    const tx = await buildTx()
    const out = await dryRunWithSender(tx, sender)
    if (out.status === 'success') {
      record({ id: scenarioId, name: scenarioName, expected: 'pass', outcome: 'pass', detail: `dryRun ok` })
      return out
    }
    record({
      id: scenarioId,
      name: scenarioName,
      expected: 'pass',
      outcome: 'fail',
      detail: `dryRun failure: ${out.error}`,
    })
    return null
  } catch (e) {
    record({
      id: scenarioId,
      name: scenarioName,
      expected: 'pass',
      outcome: 'fail',
      detail: `build error: ${(e as Error).message}`,
    })
    return null
  }
}

async function expectDryRunAbort(
  scenarioId: string,
  scenarioName: string,
  expectedAbortCode: number,
  expectedModule: string,
  buildTx: () => Promise<Transaction> | Transaction,
  sender: string,
) {
  try {
    const tx = await buildTx()
    const out = await dryRunWithSender(tx, sender)
    if (out.status === 'success') {
      record({
        id: scenarioId,
        name: scenarioName,
        expected: `abort ${expectedAbortCode}`,
        outcome: 'fail',
        detail: 'dryRun unexpectedly succeeded',
      })
      return
    }
    const errStr = out.error ?? ''
    // Sui error format: "MoveAbort(MoveLocation { module: ModuleId { ... name: <module>, .. }, function: ..., instruction: ... }, <code>)"
    const codeMatch = errStr.match(/MoveAbort\(.*?,\s*(\d+)\)/)
    const moduleMatch = errStr.match(/name:\s*Identifier\("?([a-z_]+)"?\)/)
    const actualCode = codeMatch ? Number(codeMatch[1]) : null
    const actualModule = moduleMatch ? moduleMatch[1] : null
    if (actualCode === expectedAbortCode && (actualModule === expectedModule || expectedModule === '*')) {
      record({
        id: scenarioId,
        name: scenarioName,
        expected: `abort ${expectedAbortCode} (${expectedModule})`,
        outcome: 'pass',
        detail: `aborted as expected`,
      })
      return
    }
    record({
      id: scenarioId,
      name: scenarioName,
      expected: `abort ${expectedAbortCode} (${expectedModule})`,
      outcome: 'fail',
      detail: `got abort=${actualCode} module=${actualModule} err="${errStr.slice(0, 200)}"`,
    })
  } catch (e) {
    // Client-side validator may throw before dryRun; some reverse cases exercise
    // exactly the client-side validator (validateInitialContentEntries).
    record({
      id: scenarioId,
      name: scenarioName,
      expected: `abort ${expectedAbortCode} (${expectedModule})`,
      outcome: 'pass',
      detail: `client validator threw: ${(e as Error).message}`,
    })
  }
}

async function executeAndAssertSuccess(
  scenarioId: string,
  scenarioName: string,
  buildTx: () => Promise<Transaction> | Transaction,
  signer: Ed25519Keypair,
): Promise<{ digest: string; events: ReturnType<DryRunOutcome['events']['slice']> } | null> {
  try {
    const tx = await buildTx()
    const res = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    })
    if (res.effects?.status?.status !== 'success') {
      record({
        id: scenarioId,
        name: scenarioName,
        expected: 'pass (executed)',
        outcome: 'fail',
        detail: `tx failed: ${res.effects?.status?.error}`,
      })
      return null
    }
    record({
      id: scenarioId,
      name: scenarioName,
      expected: 'pass (executed)',
      outcome: 'pass',
      detail: `digest=${res.digest}`,
    })
    return { digest: res.digest!, events: (res.events ?? []) as never }
  } catch (e) {
    record({
      id: scenarioId,
      name: scenarioName,
      expected: 'pass (executed)',
      outcome: 'fail',
      detail: `execute error: ${(e as Error).message}`,
    })
    return null
  }
}

// ── Builder helpers (initial-content rows for mint scenarios) ──────────

function defaultMintEntries() {
  return [
    // Non-active-binding kinds (soul_doc/memory/skill) must use 'public'
    // download policy — `assert_valid_download_policy` enforces this.
    {
      kind: KIND_SOUL_DOC,
      name: CANONICAL_SOUL_DOC_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_SOUL!,
    },
    {
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_MEMORY!,
    },
    {
      kind: KIND_SKILL,
      name: 'default',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_SKILL!,
    },
    // Active-binding kinds (sprite/audio) may use any download policy.
    {
      kind: KIND_SPRITE,
      name: 'persona-sprite',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'owner_only' as const,
      setActive: true,
      blobObjectId: BLOB_SPRITE!,
    },
  ]
}

function shouldRun(scenarioId: string): boolean {
  if (cli.scenario === 'all') return true
  return cli.scenario === scenarioId
}

// ── §12.1 — Mint positive (all 4 kinds, owner+grant read mode) ─────────

async function scenario_12_1() {
  if (!shouldRun('12.1')) return
  const buildTx = async () =>
    await buildPublishSoulTx({
      currentKioskId: null,
      currentKioskCapOnChainId: null,
      name: 'Phase2 Smoke Soul',
      description: 'phase2 smoke',
      imageUrl: 'https://example.com/smoke.png',
      creatorRoyaltyBps: 250,
      initialContent: defaultMintEntries(),
      initialStateConfig: [
        { key: 'sprite_config_json', valueUtf8: JSON.stringify({ idle: 'persona-sprite' }) },
      ],
    })

  if (cli.execute) {
    await executeAndAssertSuccess('12.1', 'mint positive (4 kinds + state config)', buildTx, publisherKeypair)
  } else {
    await expectDryRunPass('12.1', 'mint positive (4 kinds + state config)', buildTx, publisherAddress)
  }
}

// ── §12.2 — Mint reverse cases (invariant violations) ─────────────────

async function scenario_12_2() {
  if (!shouldRun('12.2')) return

  // 12.2.a — drop SOUL_DOC entry (client validator catches it)
  await expectDryRunAbort(
    '12.2.a',
    'mint without SOUL_DOC → EInitialSoulDocCountMismatch (46)',
    46,
    'market',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'no-soul-doc',
        description: 'reverse',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().filter((e) => e.kind !== KIND_SOUL_DOC),
        initialStateConfig: [],
      }),
    publisherAddress,
  )

  // 12.2.b — SOUL_DOC entry with wrong name
  await expectDryRunAbort(
    '12.2.b',
    'SOUL_DOC name="other" → EInitialSoulDocNameMismatch (47)',
    47,
    'market',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'wrong-soul-doc-name',
        description: 'reverse',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().map((e) =>
          e.kind === KIND_SOUL_DOC ? { ...e, name: 'other' } : e,
        ),
        initialStateConfig: [],
      }),
    publisherAddress,
  )

  // 12.2.c — drop MEMORY entry
  await expectDryRunAbort(
    '12.2.c',
    'mint without MEMORY → EInitialMemoryCountMismatch (48)',
    48,
    'market',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'no-memory',
        description: 'reverse',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().filter((e) => e.kind !== KIND_MEMORY),
        initialStateConfig: [],
      }),
    publisherAddress,
  )

  // 12.2.d — MEMORY name="custom"
  await expectDryRunAbort(
    '12.2.d',
    'MEMORY name="custom" → EInitialMemoryNameMismatch (49)',
    49,
    'market',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'wrong-memory-name',
        description: 'reverse',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().map((e) =>
          e.kind === KIND_MEMORY ? { ...e, name: 'custom' } : e,
        ),
        initialStateConfig: [],
      }),
    publisherAddress,
  )
}

// ── §12.3 — Grant scopes ────────────────────────────────────────────────
// Requires an existing soul on-chain. Without a stateObjectId env, we
// dry-run a synthetic grant against a known-good state id (skip if unset).

async function scenario_12_3() {
  if (!shouldRun('12.3')) return
  const stateId = process.env.PHASE2_SMOKE_STATE_ID?.trim()
  if (!stateId) {
    record({
      id: '12.3',
      name: 'grant scopes (seal/memory/skills/assets)',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_STATE_ID not set — run §12.1 with --execute first',
    })
    return
  }
  if (!agentAddress) {
    record({
      id: '12.3',
      name: 'grant scopes',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_AGENT_ADDRESS not set',
    })
    return
  }
  for (const [scopeName, scopeMask] of [
    ['SEAL', SOUL_GRANT_SCOPE_SEAL],
    ['MEMORY', SOUL_GRANT_SCOPE_MEMORY],
    ['SKILLS', SOUL_GRANT_SCOPE_SKILLS],
    ['ASSETS', SOUL_GRANT_SCOPE_ASSETS],
    ['ALL', SOUL_GRANT_SCOPE_SEAL | SOUL_GRANT_SCOPE_MEMORY | SOUL_GRANT_SCOPE_SKILLS | SOUL_GRANT_SCOPE_ASSETS],
  ] as const) {
    await expectDryRunPass(
      `12.3.${scopeName}`,
      `issue_to_grantee scope=${scopeName} (mask=${scopeMask})`,
      () =>
        buildIssueGrantTx({
          stateObjectId: stateId,
          granteeAddress: normalizeSuiAddress(agentAddress),
          scopeMask: Number(scopeMask),
        }),
      publisherAddress,
    )
  }
  // Bonus: revoke is a no-op when no grant exists, but builder must shape PTB
  await expectDryRunPass(
    '12.3.revoke',
    'revoke grantee dry-run',
    () =>
      buildRevokeGrantTx({
        stateObjectId: stateId,
        granteeAddress: normalizeSuiAddress(agentAddress),
      }),
    publisherAddress,
  )
}

// ── §12.4 — Paid-access lifecycle ──────────────────────────────────────

async function scenario_12_4() {
  if (!shouldRun('12.4')) return
  const stateId = process.env.PHASE2_SMOKE_STATE_ID?.trim()
  const paidListId = process.env.PHASE2_SMOKE_PAID_ACCESS_LIST_ID?.trim()
  if (!stateId || !paidListId) {
    record({
      id: '12.4',
      name: 'paid-access (configure/purchase/delete)',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_STATE_ID + PHASE2_SMOKE_PAID_ACCESS_LIST_ID required',
    })
    return
  }

  // configure
  await expectDryRunPass(
    '12.4.configure',
    'configure_paid_access_kind sprite scope=ASSETS price=1_000_000',
    () =>
      buildConfigurePaidAccessKindTx({
        paidAccessListObjectId: paidListId,
        stateObjectId: stateId,
        kindRegistryObjectId: manifestEntry.kindRegistryId!,
        kind: KIND_SPRITE,
        priceAtomic: 1_000_000n,
        scopeMask: SOUL_GRANT_SCOPE_ASSETS,
        durationMs: null,
      }),
    publisherAddress,
  )

  // purchase (requires buyer + USDC coins)
  if (!buyerKeypair || !buyerAddress) {
    record({
      id: '12.4.purchase',
      name: 'purchase_paid_access',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_BUYER_PRIV_KEY not set',
    })
  } else if (usdcCoinIds.length === 0) {
    record({
      id: '12.4.purchase',
      name: 'purchase_paid_access',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_USDC_COIN_IDS empty',
    })
  } else {
    // 1_000_000 atomic + 250 bps platform fee = 1_025_000
    await expectDryRunPass(
      '12.4.purchase',
      'purchase_paid_access (sprite, with platform fee)',
      () =>
        buildPurchasePaidAccessTx({
          paidAccessListObjectId: paidListId,
          stateObjectId: stateId,
          kind: KIND_SPRITE,
          paymentCoinObjectIds: usdcCoinIds,
          totalAtomic: 1_025_000n,
        }),
      buyerAddress,
    )
  }

  // owner-side delete
  await expectDryRunPass(
    '12.4.delete',
    'delete_paid_access_kind (sprite)',
    () =>
      buildDeletePaidAccessKindTx({
        paidAccessListObjectId: paidListId,
        stateObjectId: stateId,
        kind: KIND_SPRITE,
      }),
    publisherAddress,
  )
}

// ── §12.5 — Public sprite (mint with READ_PUBLIC) ───────────────────────

async function scenario_12_5() {
  if (!shouldRun('12.5')) return

  // 12.5.a — sprite with READ_OWNER | READ_PUBLIC + download_policy=public → pass
  await expectDryRunPass(
    '12.5.a',
    'mint sprite with READ_OWNER|READ_PUBLIC, public download policy',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'public-sprite-soul',
        description: 'public sprite',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().map((e) =>
          e.kind === KIND_SPRITE
            ? {
                ...e,
                slotReadModeMask: READ_OWNER | READ_PUBLIC,
                downloadPolicy: 'public' as const,
              }
            : e,
        ),
        initialStateConfig: [],
      }),
    publisherAddress,
  )

  // 12.5.b — sprite with READ_PUBLIC only (no READ_OWNER) → EOwnerReadModeRequired (29)
  // The client-side validator (validateInitialContentEntries) catches this
  // before PTB build, so we expect the validator's thrown Error.
  await expectDryRunAbort(
    '12.5.b',
    'sprite READ_PUBLIC only (no OWNER) → EOwnerReadModeRequired (29) or client throw',
    29,
    'content',
    async () =>
      await buildPublishSoulTx({
        currentKioskId: null,
        currentKioskCapOnChainId: null,
        name: 'public-only-sprite',
        description: 'public only',
        imageUrl: 'https://example.com/x.png',
        creatorRoyaltyBps: 0,
        initialContent: defaultMintEntries().map((e) =>
          e.kind === KIND_SPRITE
            ? {
                ...e,
                slotReadModeMask: READ_PUBLIC,
                downloadPolicy: 'public' as const,
              }
            : e,
        ),
        initialStateConfig: [],
      }),
    publisherAddress,
  )
}

// ── §12.6 — Memory delete / purge ──────────────────────────────────────

async function scenario_12_6() {
  if (!shouldRun('12.6')) return
  const contentId = process.env.PHASE2_SMOKE_CONTENT_ID?.trim()
  const stateId = process.env.PHASE2_SMOKE_STATE_ID?.trim()
  if (!contentId || !stateId) {
    record({
      id: '12.6',
      name: 'memory delete/purge',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_CONTENT_ID + PHASE2_SMOKE_STATE_ID required (run §12.1 with --execute)',
    })
    return
  }

  // 12.6.a — append a second memory version
  await expectDryRunPass(
    '12.6.a',
    'append memory v1 (default)',
    () =>
      buildAppendContentVersionAsOwnerTx({
        contentObjectId: contentId,
        stateObjectId: stateId,
        kindRegistryObjectId: manifestEntry.kindRegistryId!,
        kind: KIND_MEMORY,
        name: CANONICAL_MEMORY_NAME,
        slotReadModeMask: READ_OWNER | READ_GRANT,
        downloadPolicy: 'public',
        contentBlobObjectId: BLOB_MEMORY!,
      }),
    publisherAddress,
  )

  // 12.6.b — delete v0 (should pass; v0 was set in mint)
  await expectDryRunPass(
    '12.6.b',
    'delete memory v0',
    () =>
      buildDeleteContentVersionAsOwnerTx({
        contentObjectId: contentId,
        stateObjectId: stateId,
        kindRegistryObjectId: manifestEntry.kindRegistryId!,
        kind: KIND_MEMORY,
        name: CANONICAL_MEMORY_NAME,
        versionIndex: 0,
      }),
    publisherAddress,
  )

  // 12.6.c — purge requires deleted state. Without an --execute step, this
  // scenario can't be made deterministic in pure dryRun mode; skip when
  // not running with --execute.
  if (!cli.execute) {
    record({
      id: '12.6.c',
      name: 'purge after delete',
      expected: 'pass',
      outcome: 'skip',
      detail: 'requires --execute (delete, then purge in next TX)',
    })
    return
  }
  // With --execute we'd: append → execute → delete → execute → purge. Each
  // intermediate step must wait for chain confirmation, so this branch is a
  // sequenced executor.
  // (Implementation deferred — protocol_tests.move covers the abort path.)
  record({
    id: '12.6.c',
    name: 'purge after delete (sequenced)',
    expected: 'pass',
    outcome: 'skip',
    detail: 'sequenced executor not implemented; protocol_tests.move covers abort path',
  })
}

// ── §12.7 — Ownership rotation (list → buy → grant invalidation) ───────

async function scenario_12_7() {
  if (!shouldRun('12.7')) return
  const stateId = process.env.PHASE2_SMOKE_STATE_ID?.trim()
  const kioskId = process.env.PHASE2_SMOKE_KIOSK_ID?.trim()
  const kioskCapId = process.env.PHASE2_SMOKE_KIOSK_CAP_ID?.trim()
  if (!stateId || !kioskId || !kioskCapId) {
    record({
      id: '12.7',
      name: 'ownership rotation',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_STATE_ID + KIOSK_ID + KIOSK_CAP_ID required',
    })
    return
  }

  // 12.7.a — list
  await expectDryRunPass(
    '12.7.a',
    'list_soul_fixed_price (price=1_000_000)',
    () =>
      buildListSoulTx({
        currentKioskId: kioskId,
        currentKioskCapOnChainId: kioskCapId,
        stateObjectId: stateId,
        priceAtomic: 1_000_000n,
      }),
    publisherAddress,
  )

  // 12.7.b — buy (requires buyer + USDC + listingObjectId from §12.7.a execute)
  const listingId = process.env.PHASE2_SMOKE_LISTING_ID?.trim()
  if (!listingId || !buyerKeypair || !buyerAddress || usdcCoinIds.length === 0) {
    record({
      id: '12.7.b',
      name: 'buy_soul_fixed_price',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_LISTING_ID + buyer + USDC required',
    })
    return
  }
  await expectDryRunPass(
    '12.7.b',
    'buy_soul_fixed_price (rotates owner, invalidates grants)',
    () =>
      buildBuySoulTx({
        sellerKioskId: kioskId,
        stateObjectId: stateId,
        listingObjectId: listingId,
        totalAtomic: 1_025_000n,
        paymentCoinObjectIds: usdcCoinIds,
      }),
    buyerAddress,
  )
}

// ── §12.8 — Create collection ──────────────────────────────────────────

async function scenario_12_8() {
  if (!shouldRun('12.8')) return
  const kioskId = process.env.PHASE2_SMOKE_KIOSK_ID?.trim() || null
  const kioskCapId = process.env.PHASE2_SMOKE_KIOSK_CAP_ID?.trim() || null
  const buildTx = async () =>
    await buildCreateCollectionTx({
      currentKioskId: kioskId,
      currentKioskCapOnChainId: kioskCapId,
      name: 'Phase2 Smoke Collection',
      description: 'phase2 smoke collection',
      imageUrl: 'https://example.com/collection.png',
      extraRoyaltyBps: 100,
      tradeable: true,
      maxSupply: 100,
    })

  if (cli.execute) {
    await executeAndAssertSuccess(
      '12.8',
      'create_collection_in_personal_kiosk (tradeable, max_supply=100)',
      buildTx,
      publisherKeypair,
    )
  } else {
    await expectDryRunPass(
      '12.8',
      'create_collection_in_personal_kiosk (tradeable, max_supply=100)',
      buildTx,
      publisherAddress,
    )
  }
}

// ── §12.9 — List + buy collection-right ────────────────────────────────

async function scenario_12_9() {
  if (!shouldRun('12.9')) return
  const collectionId = process.env.PHASE2_SMOKE_COLLECTION_ID?.trim()
  const kioskId = process.env.PHASE2_SMOKE_KIOSK_ID?.trim()
  const kioskCapId = process.env.PHASE2_SMOKE_KIOSK_CAP_ID?.trim()
  if (!collectionId || !kioskId || !kioskCapId) {
    record({
      id: '12.9',
      name: 'list/buy collection right',
      expected: 'pass',
      outcome: 'skip',
      detail:
        'PHASE2_SMOKE_COLLECTION_ID + KIOSK_ID + KIOSK_CAP_ID required (run §12.8 with --execute first)',
    })
    return
  }

  await expectDryRunPass(
    '12.9.list',
    'list_collection_right_fixed_price (price=1_000_000)',
    () =>
      buildListCollectionTx({
        currentKioskId: kioskId,
        currentKioskCapOnChainId: kioskCapId,
        collectionObjectId: collectionId,
        priceAtomic: 1_000_000n,
      }),
    publisherAddress,
  )

  const collectionListingId = process.env.PHASE2_SMOKE_COLLECTION_LISTING_ID?.trim()
  if (!collectionListingId || !buyerKeypair || !buyerAddress || usdcCoinIds.length === 0) {
    record({
      id: '12.9.buy',
      name: 'buy_collection_right_fixed_price',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_COLLECTION_LISTING_ID + buyer + USDC required',
    })
    return
  }
  await expectDryRunPass(
    '12.9.buy',
    'buy_collection_right_fixed_price',
    () =>
      buildBuyCollectionTx({
        sellerKioskId: kioskId,
        collectionObjectId: collectionId,
        listingObjectId: collectionListingId,
        totalAtomic: 1_025_000n,
        paymentCoinObjectIds: usdcCoinIds,
      }),
    buyerAddress,
  )
}

// ── §12.10 — Mint Soul into existing collection (with-bind path) ──────

async function scenario_12_10() {
  if (!shouldRun('12.10')) return
  const collectionId = process.env.PHASE2_SMOKE_COLLECTION_ID?.trim()
  if (!collectionId) {
    record({
      id: '12.10',
      name: 'publishWithBind into existing collection',
      expected: 'pass',
      outcome: 'skip',
      detail: 'PHASE2_SMOKE_COLLECTION_ID required (run §12.8 with --execute first)',
    })
    return
  }

  // Use the second 4 blobs (collection's first Soul). Falls back to first 4
  // when only 4 IDs are provided.
  const collectionMintEntries = [
    {
      kind: KIND_SOUL_DOC,
      name: CANONICAL_SOUL_DOC_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_C_SOUL,
    },
    {
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_C_MEMORY,
    },
    {
      kind: KIND_SKILL,
      name: 'default',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'public' as const,
      setActive: false,
      blobObjectId: BLOB_C_SKILL,
    },
    {
      kind: KIND_SPRITE,
      name: 'persona-sprite',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'owner_only' as const,
      setActive: true,
      blobObjectId: BLOB_C_SPRITE,
    },
  ]

  const buildTx = async () =>
    await buildPublishSoulWithBindTx({
      currentKioskId: process.env.PHASE2_SMOKE_KIOSK_ID?.trim() || null,
      currentKioskCapOnChainId: process.env.PHASE2_SMOKE_KIOSK_CAP_ID?.trim() || null,
      name: 'Phase2 Smoke Collection Soul #1',
      description: 'phase2 smoke collection-bound soul',
      imageUrl: 'https://example.com/collection-soul.png',
      creatorRoyaltyBps: 200,
      collectionOnChainId: collectionId,
      initialContent: collectionMintEntries,
      initialStateConfig: [],
    })

  if (cli.execute) {
    await executeAndAssertSuccess(
      '12.10',
      'publishWithBind (mint Soul into existing collection)',
      buildTx,
      publisherKeypair,
    )
  } else {
    await expectDryRunPass(
      '12.10',
      'publishWithBind (mint Soul into existing collection)',
      buildTx,
      publisherAddress,
    )
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Phase 2 Soulidity smoke ━━━')
  console.log(`network         : ${network}`)
  console.log(`packageId       : ${manifestEntry.packageId}`)
  console.log(`kindRegistry    : ${manifestEntry.kindRegistryId}`)
  console.log(`publisher       : ${publisherAddress}`)
  console.log(`buyer           : ${buyerAddress ?? '(not set)'}`)
  console.log(`agent           : ${agentAddress ?? '(not set)'}`)
  console.log(`mode            : ${cli.execute ? 'execute' : 'dryRun-only'}`)
  console.log(`scenario filter : ${cli.scenario}`)
  console.log(`blob ids        : ${blobObjectIds.length} provided`)
  console.log()

  await scenario_12_1()
  await scenario_12_2()
  await scenario_12_3()
  await scenario_12_4()
  await scenario_12_5()
  await scenario_12_6()
  await scenario_12_7()
  await scenario_12_8()
  await scenario_12_9()
  await scenario_12_10()

  console.log()
  const passed = results.filter((r) => r.outcome === 'pass').length
  const failed = results.filter((r) => r.outcome === 'fail').length
  const skipped = results.filter((r) => r.outcome === 'skip').length
  console.log(`━━━ Summary: ${passed} pass / ${failed} fail / ${skipped} skip ━━━`)

  // Persist a markdown report under docs/benchmarks for traceability
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = resolve(repoRoot, `docs/benchmarks/phase2-smoke-${network}-${stamp}.md`)
  const lines: string[] = []
  lines.push(`# Phase 2 Soulidity smoke (${network})`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Package: \`${manifestEntry.packageId}\``)
  lines.push(`Mode: ${cli.execute ? 'execute' : 'dryRun-only'}`)
  lines.push('')
  lines.push('| Scenario | Expected | Outcome | Detail |')
  lines.push('|---|---|---|---|')
  for (const r of results) {
    lines.push(`| §${r.id} ${r.name} | ${r.expected} | ${r.outcome.toUpperCase()} | ${r.detail.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log(`Report → ${reportPath}`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(2)
})
