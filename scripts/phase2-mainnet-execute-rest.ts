#!/usr/bin/env tsx
/**
 * scripts/phase2-mainnet-execute-rest.ts
 *
 * Phase 2 mainnet smoke — sequenced executor for the scenarios that require
 * chained on-chain state (§12.3 grant, §12.4 configure/delete, §12.6 memory
 * append/delete/purge, §12.7 list/buy, §12.9 list/buy collection).
 *
 * Reads from env:
 *   MAINNET_DEPLOYER_PRIV_KEY        — owner of Soul1 + collection
 *   PHASE2_BUYER_PRIV_KEY            — buyer for §12.7 + §12.9
 *   PHASE2_AGENT_PRIV_KEY            — grant recipient (§12.3 verify)
 *   PHASE2_SMOKE_STATE_ID            — Soul1's SoulState
 *   PHASE2_SMOKE_CONTENT_ID          — Soul1's SoulContent
 *   PHASE2_SMOKE_KIOSK_ID            — publisher's personal kiosk
 *   PHASE2_SMOKE_KIOSK_CAP_ID        — publisher's PersonalKioskCap
 *   PHASE2_SMOKE_PAID_ACCESS_LIST_ID — Soul1's SoulPaidAccessList
 *   PHASE2_SMOKE_COLLECTION_ID       — collection from §12.8
 *
 * Usage:
 *   CLAWNEWS_LOAD_ENV_LOCAL=false NEXT_PUBLIC_SUI_NETWORK=mainnet \
 *     tsx scripts/phase2-mainnet-execute-rest.ts
 */

import './lib/dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'

import { decodeEd25519SecretKey } from './lib/keypair'

// ── Manifest + env wiring ─────────────────────────────────────────────

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repoRoot, 'packages/soulidity-sdk/src/deployment-manifest.json')

interface Manifest {
  packageId: string
  marketConfigId: string
  kioskRegistryId: string
  kindRegistryId?: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
}

const all = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, Manifest>
const network = (process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'mainnet') as 'mainnet' | 'testnet'
const m = all[network]!

process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = m.packageId
process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = m.marketConfigId
process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = m.kioskRegistryId
process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID = m.kindRegistryId!
process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = m.soulTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = m.collectionTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = m.paymentCoinType

const { buildIssueGrantTx } = await import('@soulidity/sdk')
const {
  buildConfigurePaidAccessKindTx,
  buildDeletePaidAccessKindTx,
} = await import('@soulidity/sdk')
const {
  buildAppendContentVersionAsOwnerTx,
  buildDeleteContentVersionAsOwnerTx,
  buildPurgeContentVersionAsOwnerTx,
} = await import('@soulidity/sdk')
const { buildListSoulTx, buildListCollectionTx } = await import('@soulidity/sdk')
const { buildBuySoulTx, buildBuyCollectionTx } = await import('@soulidity/sdk')
const {
  KIND_MEMORY,
  KIND_SPRITE,
  CANONICAL_MEMORY_NAME,
  READ_OWNER,
  READ_GRANT,
} = await import('@soulidity/sdk')
const { SOUL_GRANT_SCOPE_SEAL, SOUL_GRANT_SCOPE_ASSETS } = await import(
  '@soulidity/sdk'
)

// ── Required env ──────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

const ownerKp = decodeEd25519SecretKey(required('MAINNET_DEPLOYER_PRIV_KEY'), 'MAINNET_DEPLOYER_PRIV_KEY')
const buyerKp = decodeEd25519SecretKey(required('PHASE2_BUYER_PRIV_KEY'), 'PHASE2_BUYER_PRIV_KEY')
const agentKp = decodeEd25519SecretKey(required('PHASE2_AGENT_PRIV_KEY'), 'PHASE2_AGENT_PRIV_KEY')
const ownerAddr = ownerKp.toSuiAddress()
const buyerAddr = buyerKp.toSuiAddress()
const agentAddr = agentKp.toSuiAddress()

const STATE_ID = required('PHASE2_SMOKE_STATE_ID')
const CONTENT_ID = required('PHASE2_SMOKE_CONTENT_ID')
const KIOSK_ID = required('PHASE2_SMOKE_KIOSK_ID')
const KIOSK_CAP_ID = required('PHASE2_SMOKE_KIOSK_CAP_ID')
const PAID_LIST_ID = required('PHASE2_SMOKE_PAID_ACCESS_LIST_ID')
const COLLECTION_ID = required('PHASE2_SMOKE_COLLECTION_ID')

// Replacement memory blob for §12.6.append (since soul1-memory was consumed
// in §12.1 mint, callers must supply a fresh blob via env or reuse one of
// the unused slots).
const MEM_APPEND_BLOB = process.env.PHASE2_MEM_APPEND_BLOB?.trim()

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network })

// ── Helpers ───────────────────────────────────────────────────────────

interface Result {
  id: string
  name: string
  outcome: 'pass' | 'fail' | 'skip'
  detail: string
  digest?: string
}

const results: Result[] = []

function record(r: Result) {
  results.push(r)
  const icon = r.outcome === 'pass' ? '✓' : r.outcome === 'skip' ? '⊘' : '✗'
  console.log(`${icon} ${r.id} ${r.name} — ${r.outcome.toUpperCase()}: ${r.detail}`)
}

async function run(
  id: string,
  name: string,
  buildTx: () => Promise<Transaction> | Transaction,
  signer: Ed25519Keypair,
): Promise<{ digest: string; events: Array<{ type?: string; parsedJson?: unknown }>; objectChanges: Array<Record<string, unknown>> } | null> {
  try {
    const tx = await buildTx()
    const res = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    })
    if (res.effects?.status?.status !== 'success') {
      record({ id, name, outcome: 'fail', detail: `tx failed: ${res.effects?.status?.error}` })
      return null
    }
    record({ id, name, outcome: 'pass', detail: `digest=${res.digest}`, digest: res.digest })
    return {
      digest: res.digest,
      events: res.events ?? [],
      objectChanges: (res.objectChanges ?? []) as never,
    }
  } catch (e) {
    record({ id, name, outcome: 'fail', detail: `error: ${(e as Error).message}` })
    return null
  }
}

async function getUsdcCoin(owner: string): Promise<string | null> {
  const r = await client.getCoins({ owner, coinType: m.paymentCoinType, limit: 1 })
  return r.data[0]?.coinObjectId ?? null
}

async function findCreatedObjectId(
  oc: Array<Record<string, unknown>>,
  typeContains: string,
): Promise<string | null> {
  for (const c of oc) {
    if (c.type === 'created' && typeof c.objectType === 'string' && c.objectType.includes(typeContains)) {
      return c.objectId as string
    }
  }
  return null
}

// ── Sequence ──────────────────────────────────────────────────────────

console.log('━━━ Phase 2 mainnet execute-rest ━━━')
console.log(`packageId      : ${m.packageId}`)
console.log(`owner          : ${ownerAddr}`)
console.log(`buyer          : ${buyerAddr}`)
console.log(`agent          : ${agentAddr}`)
console.log(`state          : ${STATE_ID}`)
console.log(`content        : ${CONTENT_ID}`)
console.log(`collection     : ${COLLECTION_ID}`)
console.log()

// §12.3 — Issue grant (SEAL scope)
await run(
  '§12.3',
  'issue_to_grantee scope=SEAL',
  () =>
    buildIssueGrantTx({
      stateObjectId: STATE_ID,
      granteeAddress: agentAddr,
      scopeMask: SOUL_GRANT_SCOPE_SEAL,
    }),
  ownerKp,
)

// §12.4.configure — Configure sprite paid access
await run(
  '§12.4.configure',
  'configure_paid_access_kind sprite scope=ASSETS price=1_000_000',
  () =>
    buildConfigurePaidAccessKindTx({
      paidAccessListObjectId: PAID_LIST_ID,
      stateObjectId: STATE_ID,
      kindRegistryObjectId: m.kindRegistryId!,
      kind: KIND_SPRITE,
      priceAtomic: 1_000_000n,
      scopeMask: SOUL_GRANT_SCOPE_ASSETS,
      durationMs: null,
    }),
  ownerKp,
)

// §12.4.delete — Delete the paid access kind we just configured
await run(
  '§12.4.delete',
  'delete_paid_access_kind sprite',
  () =>
    buildDeletePaidAccessKindTx({
      paidAccessListObjectId: PAID_LIST_ID,
      stateObjectId: STATE_ID,
      kind: KIND_SPRITE,
    }),
  ownerKp,
)

// §12.6 — Memory append → delete → purge sequenced
if (!MEM_APPEND_BLOB) {
  record({
    id: '§12.6.append',
    name: 'append memory v1',
    outcome: 'skip',
    detail: 'PHASE2_MEM_APPEND_BLOB not provided (no fresh walrus blob for memory append)',
  })
} else {
  await run(
    '§12.6.append',
    'append memory v1',
    () =>
      buildAppendContentVersionAsOwnerTx({
        contentObjectId: CONTENT_ID,
        stateObjectId: STATE_ID,
        kindRegistryObjectId: m.kindRegistryId!,
        kind: KIND_MEMORY,
        name: CANONICAL_MEMORY_NAME,
        slotReadModeMask: READ_OWNER | READ_GRANT,
        downloadPolicy: 'public',
        contentBlobObjectId: MEM_APPEND_BLOB,
      }),
    ownerKp,
  )
}

await run(
  '§12.6.delete',
  'delete memory v0',
  () =>
    buildDeleteContentVersionAsOwnerTx({
      contentObjectId: CONTENT_ID,
      stateObjectId: STATE_ID,
      kindRegistryObjectId: m.kindRegistryId!,
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      versionIndex: 0,
    }),
  ownerKp,
)

await run(
  '§12.6.purge',
  'purge_deleted_version_as_owner memory v0',
  () =>
    buildPurgeContentVersionAsOwnerTx({
      contentObjectId: CONTENT_ID,
      stateObjectId: STATE_ID,
      kindRegistryObjectId: m.kindRegistryId!,
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      versionIndex: 0,
    }),
  ownerKp,
)

// §12.7 — List Soul, capture listing_id, buyer buys
const listRes = await run(
  '§12.7.list',
  'list_soul_fixed_price (price=1_000_000)',
  () =>
    buildListSoulTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      stateObjectId: STATE_ID,
      priceAtomic: 1_000_000n,
    }),
  ownerKp,
)

const listingId = listRes
  ? await findCreatedObjectId(listRes.objectChanges, '::market::SoulListing')
  : null

if (!listingId) {
  record({ id: '§12.7.buy', name: 'buy_soul_fixed_price', outcome: 'skip', detail: 'no listing_id' })
} else {
  const buyerUsdc = await getUsdcCoin(buyerAddr)
  if (!buyerUsdc) {
    record({ id: '§12.7.buy', name: 'buy_soul_fixed_price', outcome: 'skip', detail: 'buyer has no USDC' })
  } else {
    await run(
      '§12.7.buy',
      `buy_soul_fixed_price (listing=${listingId})`,
      () =>
        buildBuySoulTx({
          sellerKioskId: KIOSK_ID,
          stateObjectId: STATE_ID,
          listingObjectId: listingId,
          // 1_000_000 price + 250bps platform + 250bps creator royalty = 1_050_000
          totalAtomic: 1_050_000n,
          paymentCoinObjectIds: [buyerUsdc],
        }),
      buyerKp,
    )
  }
}

// §12.9 — List collection, buy collection right
const collListRes = await run(
  '§12.9.list',
  'list_collection_right_fixed_price (price=1_000_000)',
  () =>
    buildListCollectionTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      collectionObjectId: COLLECTION_ID,
      priceAtomic: 1_000_000n,
    }),
  ownerKp,
)

const collListingId = collListRes
  ? await findCreatedObjectId(collListRes.objectChanges, '::market::CollectionListing')
  : null

if (!collListingId) {
  record({
    id: '§12.9.buy',
    name: 'buy_collection_right_fixed_price',
    outcome: 'skip',
    detail: 'no collection listing_id',
  })
} else {
  const buyerUsdc = await getUsdcCoin(buyerAddr)
  if (!buyerUsdc) {
    record({
      id: '§12.9.buy',
      name: 'buy_collection_right_fixed_price',
      outcome: 'skip',
      detail: 'buyer has no USDC',
    })
  } else {
    await run(
      '§12.9.buy',
      `buy_collection_right_fixed_price (listing=${collListingId})`,
      () =>
        buildBuyCollectionTx({
          sellerKioskId: KIOSK_ID,
          collectionObjectId: COLLECTION_ID,
          listingObjectId: collListingId,
          totalAtomic: 1_025_000n,
          paymentCoinObjectIds: [buyerUsdc],
        }),
      buyerKp,
    )
  }
}

// ── Summary ───────────────────────────────────────────────────────────

console.log()
const passed = results.filter((r) => r.outcome === 'pass').length
const failed = results.filter((r) => r.outcome === 'fail').length
const skipped = results.filter((r) => r.outcome === 'skip').length
console.log(`━━━ Summary: ${passed} pass / ${failed} fail / ${skipped} skip ━━━`)
process.exit(failed > 0 ? 1 : 0)
