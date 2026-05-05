/**
 * Phase 2 paid-access lifecycle helper for E2E.
 *
 * Wraps the @soulidity/sdk per-kind paid-access PTB builders so the test
 * plan can drive the full lifecycle from a Node CLI without touching
 * deleted Phase-1 entry points (`content_access::*` are gone).
 *
 * Subcommands:
 *   set-config     — owner-only configure_paid_access_kind (initial)
 *   update-config  — owner-only update_paid_access_kind (mutate price/scope/duration)
 *   delete-config  — owner-only delete_paid_access_kind
 *   purchase       — buyer purchase_paid_access (USDC payment)
 *   add-access     — owner-only paid_access::add_access (free grant)
 *   revoke         — owner-only paid_access::revoke_access
 *   cleanup        — anyone paid_access::cleanup_stale_entries
 *   inspect-config — devInspect kind config accessors (no signing)
 *   inspect-access — devInspect paid_access::has_access (no signing)
 *
 * Env (PACKAGE / market / kindRegistry / paymentCoinType bridge to
 * NEXT_PUBLIC_SOULIDITY_* aliases for the SDK):
 *   PACKAGE_ID                            — Soulidity package
 *   MARKET_CONFIG_ID
 *   KIOSK_REGISTRY_ID                     — (optional)
 *   KIND_REGISTRY_ID
 *   PAYMENT_COIN_TYPE                     — defaults to manifest.mainnet.paymentCoinType
 *
 *   PAID_ACCESS_LIST_ID                   — SoulPaidAccessList shared object
 *   STATE_ID                              — SoulState
 *   KIND                                  — u32 (KIND_SPRITE=3, KIND_AUDIO=4)
 *
 *   OWNER_PRIVATE_KEY                     — owner-side actions
 *   BUYER_PRIVATE_KEY                     — buyer-side actions (purchase)
 *
 *   PRICE_ATOMIC                          — set/update-config (USDC atomic)
 *   SCOPE_MASK                            — set/update/add-access (must equal kind's default scope)
 *   DURATION_MS                           — set/update-config (Option<u64>; empty = lifetime)
 *
 *   GRANTEE_ADDRESS                       — add-access / revoke
 *   EXPIRES_AT_MS                         — add-access (Option<u64>; empty = lifetime)
 *
 *   PLATFORM_FEE_BPS                      — purchase (default 250)
 *   TOTAL_ATOMIC                          — purchase (computed from PRICE_ATOMIC + fee if absent)
 *
 *   CLEANUP_ADDRESSES                     — cleanup (comma-separated 0x…)
 *   CLEANUP_KINDS                         — cleanup (comma-separated u32)
 *
 *   REQUIRED_SCOPE                        — inspect-access (u64)
 *   INSPECT_SENDER                        — inspect-access (default GRANTEE_ADDRESS)
 *
 * Usage:
 *   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
 *     PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" STATE_ID="$SOUL_B_STATE_OBJ" \
 *     KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" KIND=3 \
 *     PRICE_ATOMIC=100000 SCOPE_MASK=8 DURATION_MS=5000 \
 *     npx tsx web/scripts/e2e-paid-access-lifecycle.ts set-config
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import {
  buildAddPaidAccessTx,
  buildCleanupStalePaidAccessTx,
  buildConfigurePaidAccessKindTx,
  buildDeletePaidAccessKindTx,
  buildPurchasePaidAccessTx,
  buildRevokePaidAccessTx,
  buildUpdatePaidAccessKindTx,
  extractSoulPaidAccessGrantedEvent,
  extractSoulPaidAccessKindConfiguredEvent,
  extractSoulPaidAccessKindDeletedEvent,
  extractSoulPaidAccessKindUpdatedEvent,
  extractSoulPaidAccessRevokedEvent,
  selectCoinObjectIdsForAmountAcrossPages,
} from '@soulidity/sdk'

import { prisma } from '../lib/prisma'
import {
  markPaidAccessEntryRevokedFromChain,
  markPaidAccessKindConfigDeletedFromChain,
  syncPaidAccessEntryFromChain,
  syncPaidAccessKindConfigFromChain,
} from '../lib/soulidity/mirror/sync-helpers'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')
const MANIFEST_PATH = join(REPO_ROOT, 'packages/soulidity-sdk/src/deployment-manifest.json')

type Network = 'mainnet' | 'testnet' | 'devnet'
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'mainnet') as Network
type SuiClient = SuiJsonRpcClient
type TxResult = Awaited<ReturnType<SuiClient['executeTransactionBlock']>>

function readManifestField(network: Network, key: string): string | undefined {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, Record<string, string | undefined>>
  return manifest[network]?.[key]?.trim()
}

function bridgeSdkEnv(): {
  packageId: string
  marketConfigId: string
  kindRegistryId: string
  paymentCoinType: string
} {
  // The SDK builders read NEXT_PUBLIC_SOULIDITY_* env keys (with manifest
  // fallback). Bridge whichever name the operator used so a `.env.e2e`
  // shell that exports `PACKAGE_ID=…` works the same as one that uses the
  // canonical `NEXT_PUBLIC_SOULIDITY_PACKAGE_ID=…`.
  const pkg =
    process.env.PACKAGE_ID?.trim() ||
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID?.trim() ||
    readManifestField(SUI_NETWORK, 'packageId')
  if (!pkg) throw new Error(`PACKAGE_ID not set and manifest.${SUI_NETWORK}.packageId missing`)

  const market =
    process.env.MARKET_CONFIG_ID?.trim() ||
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID?.trim() ||
    readManifestField(SUI_NETWORK, 'marketConfigId')
  if (!market) throw new Error('MARKET_CONFIG_ID not set and manifest fallback missing')

  const kindReg =
    process.env.KIND_REGISTRY_ID?.trim() ||
    process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID?.trim() ||
    readManifestField(SUI_NETWORK, 'kindRegistryId')
  if (!kindReg) throw new Error('KIND_REGISTRY_ID not set and manifest fallback missing')

  const paymentCoinType =
    process.env.PAYMENT_COIN_TYPE?.trim() ||
    process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE?.trim() ||
    readManifestField(SUI_NETWORK, 'paymentCoinType')
  if (!paymentCoinType) throw new Error('PAYMENT_COIN_TYPE not set and manifest fallback missing')

  process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = pkg
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = market
  process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID = kindReg
  process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = paymentCoinType
  return { packageId: pkg, marketConfigId: market, kindRegistryId: kindReg, paymentCoinType }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

function parseUintEnv(name: string, requireValue: 'required' | 'optional' = 'required'): bigint | null {
  const value = optionalEnv(name)
  if (!value) {
    if (requireValue === 'required') throw new Error(`${name} is required`)
    return null
  }
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`)
  return BigInt(value)
}

function parseKind(): number {
  const raw = requireEnv('KIND')
  if (!/^\d+$/.test(raw)) throw new Error(`KIND must be an unsigned integer (u32)`)
  const k = Number(raw)
  if (!Number.isInteger(k) || k < 0 || k > 0xffff_ffff) throw new Error('KIND out of u32 range')
  return k
}

function loadKeypair(envName: 'OWNER_PRIVATE_KEY' | 'BUYER_PRIVATE_KEY'): Ed25519Keypair {
  const raw = requireEnv(envName)
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(raw).secretKey)
}

function makeClient(): SuiClient {
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK })
}

function statusSucceeded(result: TxResult): boolean {
  return result.effects?.status.status === 'success'
}

function txTimestampMs(result: TxResult): bigint {
  const raw = result.timestampMs
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw)
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(Math.trunc(raw))
  return BigInt(Date.now())
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  )
}

async function mirrorPaidAccessTx(params: {
  action: 'set-config' | 'update-config' | 'delete-config' | 'purchase' | 'add-access' | 'revoke'
  packageId: string
  result: TxResult
}) {
  if (!statusSucceeded(params.result)) return

  if (params.action === 'set-config') {
    const event = extractSoulPaidAccessKindConfiguredEvent(params.result, params.packageId)
    await syncPaidAccessKindConfigFromChain({
      soulOnChainId: event.soulId,
      paidAccessListOnChainId: event.paidAccessListId,
      kind: event.kind,
      version: 1,
      priceAtomic: event.priceAtomic,
      scopeMask: event.scopeMask,
      durationMs: event.durationMs,
      ownershipEpochSnapshot: event.ownershipEpochSnapshot,
    })
    console.log(stringifyJson({ mirror: 'soul_paid_access_kind_configs', action: params.action, event }))
    return
  }

  if (params.action === 'update-config') {
    const event = extractSoulPaidAccessKindUpdatedEvent(params.result, params.packageId)
    await syncPaidAccessKindConfigFromChain({
      soulOnChainId: event.soulId,
      paidAccessListOnChainId: event.paidAccessListId,
      kind: event.kind,
      version: 1,
      priceAtomic: event.newPriceAtomic,
      scopeMask: event.newScopeMask,
      durationMs: event.newDurationMs,
      ownershipEpochSnapshot: event.ownershipEpochSnapshot,
    })
    console.log(stringifyJson({ mirror: 'soul_paid_access_kind_configs', action: params.action, event }))
    return
  }

  if (params.action === 'delete-config') {
    const event = extractSoulPaidAccessKindDeletedEvent(params.result, params.packageId)
    await markPaidAccessKindConfigDeletedFromChain({
      paidAccessListOnChainId: event.paidAccessListId,
      kind: event.kind,
    })
    console.log(stringifyJson({ mirror: 'soul_paid_access_kind_configs', action: params.action, event }))
    return
  }

  if (params.action === 'purchase' || params.action === 'add-access') {
    const event = extractSoulPaidAccessGrantedEvent(params.result, params.packageId)
    await syncPaidAccessEntryFromChain({
      soulOnChainId: event.soulId,
      paidAccessListOnChainId: event.paidAccessListId,
      buyerAddress: event.granteeAddress,
      kind: event.kind,
      version: 1,
      scopeMask: event.scopeMask,
      pricePaidAtomic: event.pricePaidAtomic,
      expiresAtMs: event.expiresAtMs,
      ownershipEpochSnapshot: event.ownershipEpochSnapshot,
      createdAtMs: txTimestampMs(params.result),
    })
    console.log(stringifyJson({ mirror: 'soul_paid_access_entries', action: params.action, event }))
    return
  }

  const event = extractSoulPaidAccessRevokedEvent(params.result, params.packageId)
  await markPaidAccessEntryRevokedFromChain({
    paidAccessListOnChainId: event.paidAccessListId,
    buyerAddress: event.granteeAddress,
    kind: event.kind,
  })
  console.log(stringifyJson({ mirror: 'soul_paid_access_entries', action: params.action, event }))
}

async function mirrorCleanupTx(params: {
  result: TxResult
  paidAccessListId: string
  pairs: Array<{ address: string; kind: number }>
}) {
  if (!statusSucceeded(params.result)) return
  const deleted = []
  for (const pair of params.pairs) {
    const result = await prisma.soulPaidAccessEntry.deleteMany({
      where: {
        paidAccessListOnChainId: params.paidAccessListId,
        buyerAddress: pair.address,
        kind: pair.kind,
      },
    })
    deleted.push({ ...pair, count: result.count })
  }
  console.log(stringifyJson({ mirror: 'soul_paid_access_entries', action: 'cleanup', deleted }))
}

async function signAndExecute(
  tx: Transaction,
  keypair: Ed25519Keypair,
  client: SuiClient,
  action: string,
): Promise<TxResult> {
  const sender = normalizeSuiAddress(keypair.toSuiAddress())
  tx.setSender(sender)
  const bytes = await tx.build({ client })
  const { signature } = await keypair.signTransaction(bytes)
  const result = await client.executeTransactionBlock({
    transactionBlock: Buffer.from(bytes).toString('base64'),
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
  await client.waitForTransaction({ digest: result.digest }).catch(() => undefined)
  console.log(
    JSON.stringify(
      {
        action,
        sender,
        digest: result.digest,
        status: result.effects?.status,
        events: (result.events ?? []).map((event) => ({ type: event.type, parsedJson: event.parsedJson })),
      },
      null,
      2,
    ),
  )
  if (!statusSucceeded(result)) {
    throw new Error(`${action} transaction failed: ${result.effects?.status.error ?? 'unknown error'}`)
  }
  return result
}

// ── Owner-side mutations ─────────────────────────────────────────────────

async function setConfig(client: SuiClient) {
  const env = bridgeSdkEnv()
  const tx = buildConfigurePaidAccessKindTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    kindRegistryObjectId: requireEnv('KIND_REGISTRY_ID'),
    kind: parseKind(),
    priceAtomic: parseUintEnv('PRICE_ATOMIC') as bigint,
    scopeMask: Number(parseUintEnv('SCOPE_MASK') as bigint),
    durationMs: parseUintEnv('DURATION_MS', 'optional'),
  })
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'set-config')
  await mirrorPaidAccessTx({ action: 'set-config', packageId: env.packageId, result })
}

async function updateConfig(client: SuiClient) {
  const env = bridgeSdkEnv()
  const tx = buildUpdatePaidAccessKindTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    kindRegistryObjectId: requireEnv('KIND_REGISTRY_ID'),
    kind: parseKind(),
    priceAtomic: parseUintEnv('PRICE_ATOMIC') as bigint,
    scopeMask: Number(parseUintEnv('SCOPE_MASK') as bigint),
    durationMs: parseUintEnv('DURATION_MS', 'optional'),
  })
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'update-config')
  await mirrorPaidAccessTx({ action: 'update-config', packageId: env.packageId, result })
}

async function deleteConfig(client: SuiClient) {
  const env = bridgeSdkEnv()
  const tx = buildDeletePaidAccessKindTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    kind: parseKind(),
  })
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'delete-config')
  await mirrorPaidAccessTx({ action: 'delete-config', packageId: env.packageId, result })
}

async function addAccess(client: SuiClient) {
  const env = bridgeSdkEnv()
  const tx = buildAddPaidAccessTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    kindRegistryObjectId: requireEnv('KIND_REGISTRY_ID'),
    granteeAddress: normalizeSuiAddress(requireEnv('GRANTEE_ADDRESS')),
    kind: parseKind(),
    scopeMask: Number(parseUintEnv('SCOPE_MASK') as bigint),
    expiresAtMs: parseUintEnv('EXPIRES_AT_MS', 'optional'),
  })
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'add-access')
  await mirrorPaidAccessTx({ action: 'add-access', packageId: env.packageId, result })
}

async function revoke(client: SuiClient) {
  const env = bridgeSdkEnv()
  const tx = buildRevokePaidAccessTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    granteeAddress: normalizeSuiAddress(requireEnv('GRANTEE_ADDRESS')),
    kind: parseKind(),
  })
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'revoke')
  await mirrorPaidAccessTx({ action: 'revoke', packageId: env.packageId, result })
}

async function cleanup(client: SuiClient) {
  bridgeSdkEnv()
  const addrs = requireEnv('CLEANUP_ADDRESSES').split(',').map((s) => normalizeSuiAddress(s.trim()))
  const kinds = requireEnv('CLEANUP_KINDS')
    .split(',')
    .map((s) => Number(s.trim()))
  if (addrs.length !== kinds.length) {
    throw new Error('CLEANUP_ADDRESSES / CLEANUP_KINDS length mismatch')
  }
  const tx = buildCleanupStalePaidAccessTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    addrs,
    kinds,
  })
  // Anyone may call cleanup; signer can be either OWNER_PRIVATE_KEY or
  // OWNER-equivalent. We accept OWNER_PRIVATE_KEY here for symmetry.
  const result = await signAndExecute(tx, loadKeypair('OWNER_PRIVATE_KEY'), client, 'cleanup')
  await mirrorCleanupTx({
    result,
    paidAccessListId: requireEnv('PAID_ACCESS_LIST_ID'),
    pairs: addrs.map((address, index) => ({ address, kind: kinds[index] as number })),
  })
}

// ── Buyer-side purchase ───────────────────────────────────────────────────

async function purchase(client: SuiClient) {
  const env = bridgeSdkEnv()
  const buyer = loadKeypair('BUYER_PRIVATE_KEY')
  const buyerAddress = normalizeSuiAddress(buyer.toSuiAddress())
  const kind = parseKind()
  const priceAtomic = parseUintEnv('PRICE_ATOMIC') as bigint
  const platformFeeBps = optionalEnv('PLATFORM_FEE_BPS') ? Number(optionalEnv('PLATFORM_FEE_BPS')) : 250

  // Total = price + platform fee (bps applied to price, rounded down).
  const totalAtomic =
    parseUintEnv('TOTAL_ATOMIC', 'optional') ??
    priceAtomic + (priceAtomic * BigInt(platformFeeBps)) / 10_000n

  const explicit = optionalEnv('PAYMENT_COIN_OBJECT_IDS')
  let paymentCoinObjectIds: string[] | null = explicit ? explicit.split(',').map((s) => s.trim()) : null
  if (!paymentCoinObjectIds) {
    const selected = await selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: buyerAddress,
      coinType: env.paymentCoinType,
      requiredAmount: totalAtomic,
    })
    if (!selected || selected.length === 0) {
      throw new Error(`Buyer ${buyerAddress} has insufficient ${env.paymentCoinType} for total ${totalAtomic}`)
    }
    paymentCoinObjectIds = selected
  }

  const tx = buildPurchasePaidAccessTx({
    paidAccessListObjectId: requireEnv('PAID_ACCESS_LIST_ID'),
    stateObjectId: requireEnv('STATE_ID'),
    kind,
    paymentCoinObjectIds,
    totalAtomic,
  })
  const result = await signAndExecute(tx, buyer, client, 'purchase')
  await mirrorPaidAccessTx({ action: 'purchase', packageId: env.packageId, result })
}

// ── DevInspect (read-only) ───────────────────────────────────────────────

function parseDevInspectBool(response: unknown): boolean | null {
  const effects = (response as { results?: Array<{ returnValues?: unknown[] }> }).results ?? []
  const returnValue = effects.flatMap((item) => item.returnValues ?? [])[0]
  if (!Array.isArray(returnValue) || !Array.isArray(returnValue[0])) return null
  const firstByte = returnValue[0][0]
  if (firstByte === 0) return false
  if (firstByte === 1) return true
  return null
}

function parseDevInspectU64(response: unknown, callIndex: number): bigint | null {
  const effects = (response as { results?: Array<{ returnValues?: unknown[] }> }).results ?? []
  const command = effects[callIndex]
  if (!command?.returnValues) return null
  const returnValue = command.returnValues[0]
  if (!Array.isArray(returnValue) || !Array.isArray(returnValue[0])) return null
  const bytes = returnValue[0] as number[]
  if (bytes.length !== 8) return null
  let value = 0n
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[i]) << BigInt(i * 8)
  }
  return value
}

function parseDevInspectOptionU64(response: unknown, callIndex: number): bigint | null | undefined {
  const effects = (response as { results?: Array<{ returnValues?: unknown[] }> }).results ?? []
  const command = effects[callIndex]
  if (!command?.returnValues) return undefined
  const returnValue = command.returnValues[0]
  if (!Array.isArray(returnValue) || !Array.isArray(returnValue[0])) return undefined
  const bytes = returnValue[0] as number[]
  if (bytes.length === 0) return null
  // BCS Option<u64>: 1 byte tag (0=None, 1=Some) then 8 bytes if Some.
  if (bytes[0] === 0) return null
  if (bytes[0] !== 1 || bytes.length !== 9) return undefined
  let value = 0n
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[1 + i]) << BigInt(i * 8)
  }
  return value
}

export function buildInspectConfigTx(params: {
  packageId: string
  paidAccessListObjectId: string
  kind: number
}): Transaction {
  const tx = new Transaction()
  // command 0: has_kind_config -> bool
  tx.moveCall({
    target: `${params.packageId}::paid_access::has_kind_config`,
    arguments: [tx.object(params.paidAccessListObjectId), tx.pure.u32(params.kind)],
  })
  // command 1: kind_config_price_atomic -> u64
  tx.moveCall({
    target: `${params.packageId}::paid_access::kind_config_price_atomic`,
    arguments: [tx.object(params.paidAccessListObjectId), tx.pure.u32(params.kind)],
  })
  // command 2: kind_config_scope_mask -> u64
  tx.moveCall({
    target: `${params.packageId}::paid_access::kind_config_scope_mask`,
    arguments: [tx.object(params.paidAccessListObjectId), tx.pure.u32(params.kind)],
  })
  // command 3: kind_config_duration_ms -> Option<u64>
  tx.moveCall({
    target: `${params.packageId}::paid_access::kind_config_duration_ms`,
    arguments: [tx.object(params.paidAccessListObjectId), tx.pure.u32(params.kind)],
  })
  return tx
}

async function inspectConfig(client: SuiClient) {
  const env = bridgeSdkEnv()
  const paidAccessListId = requireEnv('PAID_ACCESS_LIST_ID')
  const kind = parseKind()
  const sender = optionalEnv('INSPECT_SENDER') || normalizeSuiAddress('0x0')
  const tx = buildInspectConfigTx({ packageId: env.packageId, paidAccessListObjectId: paidAccessListId, kind })
  const result = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
  const exists = parseDevInspectBool({ results: [(result.results ?? [])[0]] })
  const price = parseDevInspectU64(result, 1)
  const scope = parseDevInspectU64(result, 2)
  const duration = parseDevInspectOptionU64(result, 3)
  console.log(
    JSON.stringify(
      {
        action: 'inspect-config',
        paidAccessListId,
        kind,
        exists,
        priceAtomic: price?.toString() ?? null,
        scopeMask: scope?.toString() ?? null,
        durationMs: duration === undefined ? null : duration?.toString() ?? null,
        status: result.effects?.status,
      },
      null,
      2,
    ),
  )
}

export function buildInspectAccessTx(params: {
  packageId: string
  paidAccessListObjectId: string
  stateObjectId: string
  granteeAddress: string
  kind: number
  requiredScope: number | bigint
}): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${params.packageId}::paid_access::has_access`,
    arguments: [
      tx.object(params.paidAccessListObjectId),
      tx.object(params.stateObjectId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u32(params.kind),
      tx.pure.u64(BigInt(params.requiredScope)),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

async function inspectAccess(client: SuiClient) {
  const env = bridgeSdkEnv()
  const paidAccessListId = requireEnv('PAID_ACCESS_LIST_ID')
  const stateId = requireEnv('STATE_ID')
  const granteeAddress = normalizeSuiAddress(requireEnv('GRANTEE_ADDRESS'))
  const kind = parseKind()
  const requiredScope = parseUintEnv('REQUIRED_SCOPE') as bigint
  const sender = optionalEnv('INSPECT_SENDER') || granteeAddress
  const tx = buildInspectAccessTx({
    packageId: env.packageId,
    paidAccessListObjectId: paidAccessListId,
    stateObjectId: stateId,
    granteeAddress,
    kind,
    requiredScope,
  })
  const result = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
  const hasAccess = parseDevInspectBool(result)
  console.log(
    JSON.stringify(
      {
        action: 'inspect-access',
        paidAccessListId,
        granteeAddress,
        kind,
        requiredScope: requiredScope.toString(),
        hasAccess,
        status: result.effects?.status,
      },
      null,
      2,
    ),
  )
  if (hasAccess == null) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }
}

// ── Entry ────────────────────────────────────────────────────────────────

const USAGE =
  'Usage: e2e-paid-access-lifecycle.ts ' +
  'set-config|update-config|delete-config|purchase|add-access|revoke|cleanup|inspect-config|inspect-access'

export async function main() {
  const action = process.argv[2]
  const client = makeClient()
  switch (action) {
    case 'set-config':
      await setConfig(client)
      return
    case 'update-config':
      await updateConfig(client)
      return
    case 'delete-config':
      await deleteConfig(client)
      return
    case 'purchase':
      await purchase(client)
      return
    case 'add-access':
      await addAccess(client)
      return
    case 'revoke':
      await revoke(client)
      return
    case 'cleanup':
      await cleanup(client)
      return
    case 'inspect-config':
      await inspectConfig(client)
      return
    case 'inspect-access':
      await inspectAccess(client)
      return
    default:
      throw new Error(USAGE)
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
