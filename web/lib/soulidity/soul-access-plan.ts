import { bcs } from '@mysten/sui/bcs'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { SoulStatePublicBcs, SoulDetailStateBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE,
  type SoulDetailStateSnapshot } from '@soulidity/sdk'

export const SOUL_ACCESS_MAX = 18446744073709551615n
export const SOUL_ACCESS_CLOCK = `0x${'0'.repeat(63)}6`
export type SoulAccessAction = 'grant-issue' | 'grant-revoke' | 'grant-revoke-scope'
  | 'paid-configure' | 'paid-update' | 'paid-delete' | 'paid-purchase' | 'paid-revoke'
export interface SoulAccessDeployment {
  chainIdentifier: string; originalPackageId: string; callablePackageId: string
  kindRegistryId: string; marketConfigId: string; paymentCoinType: string
}
export interface SoulAccessPaymentCoin { objectId: string; version: string; digest: string; balance: string }
/** User input, before raw observations have fixed the scope, price and recipients. */
export interface SoulAccessRequest {
  action: SoulAccessAction; kind?: number; granteeAddress?: string; scopeMask?: number
  expiresAtMs?: string | null; priceAtomic?: string; durationMs?: string | null
  /** Required for replacing any same-epoch finite entry, including an expired one. */
  renew?: boolean; paymentCoins?: SoulAccessPaymentCoin[]
}
export interface SoulAccessState {
  deployment: SoulAccessDeployment; soulId: string; stateId: string; contentId: string; paidAccessListId: string; author: string
  snapshot: SoulDetailStateSnapshot; stateBcs: string; paidBcs: string; marketConfigBcs: string
  /** Exact optional outer Table row for the requested buyer, not an inferred list count. */
  buyerAddress: string; buyerTableBcs: string | null; kind: number | null; descriptorBcs: string | null
}
export interface SoulAccessQuote {
  scopeMask: number; capacity: string | null
  priceAtomic: string; feeAtomic: string; totalAtomic: string; feeRecipient: string | null; durationMs: string | null
  /** Estimate at capturedAtMs. Final purchase expiry uses the executed transaction's Clock. */
  expiresAtMs: string | null
}
export interface SoulAccessPlan {
  deployment: SoulAccessDeployment; soulId: string; stateId: string; contentId: string; paidAccessListId: string
  author: string; currentOwner: string; ownershipEpoch: string; capturedAtMs: string
  action: SoulAccessAction; kind: number | null; granteeAddress: string | null
  expected: {
    stateBcs: string; paidBcs: string; marketConfigBcs: string | null; descriptorBcs: string | null
    grantSlotBcs: string | null; grantLive: boolean | null
    paidConfigBcs: string | null; buyerTableBcs: string | null; paidEntryBcs: string | null
  }
  input: {
    scopeMask: number | null; expiresAtMs: string | null; priceAtomic: string | null; durationMs: string | null
    renew: boolean; paymentCoins: SoulAccessPaymentCoin[]
  }
  quote: SoulAccessQuote
}
export interface SoulAccessRecord {
  schema: 'soulidity.soul-access.v1'; plan: SoulAccessPlan
  packet: { bytes: string; digest: string; expirationEpoch: string
    phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; signature: string | null }
}
export interface SoulAccessQuery {
  status: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; checkpoint?: string
  stateVersion?: string; paidAccessVersion?: string; grantId?: string; expiresAtMs?: string | null
}
export function soulAccessCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`SOUL_ACCESS_${code}`)
}
export function soulAccessExact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  soulAccessCheck(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS')
}
export function soulAccessAddress(value: unknown, nonzero = true): asserts value is string {
  soulAccessCheck(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)
    && (!nonzero || !/^0x0+$/.test(value)), 'INVALID_ADDRESS')
}
export function soulAccessUint(value: unknown, positive = false): asserts value is string {
  soulAccessCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= SOUL_ACCESS_MAX && (!positive || BigInt(value) > 0n), 'INVALID_U64')
}
export function soulAccessDigest(value: unknown): asserts value is string {
  soulAccessCheck(typeof value === 'string' && value.length <= 44 && fromBase58(value).length === 32
    && toBase58(fromBase58(value)) === value, 'INVALID_DIGEST')
}
export const soulAccessCanonical = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
export const soulAccessSame = (a: unknown, b: unknown): boolean => soulAccessCanonical(a) === soulAccessCanonical(b)
export function soulAccessFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(soulAccessFreeze); Object.freeze(value) }
  return value
}
export type SoulAccessCodec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
export function soulAccessDecode<C extends SoulAccessCodec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  soulAccessCheck(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS')
  return value
}
export function soulAccessBcs<C extends SoulAccessCodec>(codec: C, encoded: unknown): ReturnType<C['parse']> {
  soulAccessCheck(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 32768, 'BCS_BUDGET')
  const bytes = fromBase64(encoded); soulAccessCheck(toBase64(bytes) === encoded, 'NONCANONICAL_BASE64')
  return soulAccessDecode(codec, bytes)
}
const check: typeof soulAccessCheck = soulAccessCheck
const uint: typeof soulAccessUint = soulAccessUint
const id: typeof soulAccessAddress = soulAccessAddress
const exact: typeof soulAccessExact = soulAccessExact
export function parseSoulAccessDeployment(input: unknown): SoulAccessDeployment {
  const d = structuredClone(input) as SoulAccessDeployment
  exact(d, ['chainIdentifier', 'originalPackageId', 'callablePackageId', 'kindRegistryId', 'marketConfigId', 'paymentCoinType'])
  check(typeof d.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(d.chainIdentifier)
    && d.paymentCoinType === SOUL_PUBLIC_USDC_TYPE, 'DEPLOYMENT_INVALID')
  ;[d.originalPackageId, d.callablePackageId, d.kindRegistryId, d.marketConfigId].forEach(value => id(value))
  return d
}
export function soulAccessIsGrant(action: SoulAccessAction) { return action.startsWith('grant-') }
export function soulAccessUsesMarket(action: SoulAccessAction) { return action.startsWith('paid-') && action !== 'paid-revoke' }
function kind(value: unknown): asserts value is number {
  check(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff, 'INVALID_KIND')
}
function scope(value: unknown): asserts value is number {
  check(Number.isInteger(value) && (value as number) > 0 && (value as number) <= 15, 'INVALID_SCOPE')
}
export const SoulAccessCoinBcs = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })

/** Pure quote derivation is also run during journal parsing: local metadata can
 * never silently replace a signed target with another amount, mask or recipient. */
function deriveQuote(p: SoulAccessPlan, requireCoins: boolean): SoulAccessQuote {
  const s = soulAccessBcs(SoulStatePublicBcs, p.expected.stateBcs)
  const paid = soulAccessBcs(SoulDetailStateBcs.Paid, p.expected.paidBcs)
  check(s.version === '1' && s.id === p.stateId && s.soul_id === p.soulId && s.current_owner === p.currentOwner
    && s.ownership_epoch === p.ownershipEpoch && s.content_id === p.contentId && s.access_list_id === p.paidAccessListId
    && paid.version === '1' && paid.id === p.paidAccessListId && paid.soul_id === p.soulId && paid.creator === s.creator, 'ROOT_MISMATCH')
  const roots = [p.soulId, p.stateId, p.contentId, p.paidAccessListId, p.deployment.kindRegistryId,
    p.deployment.marketConfigId, SOUL_ACCESS_CLOCK, s.active_grants.id, s.active_grant_ids.id, s.config_ext.id,
    paid.entries.id, paid.kind_configs.id]
  roots.forEach(value => id(value))
  check(new Set(roots).size === roots.length && !roots.includes(p.deployment.originalPackageId)
    && !roots.includes(p.deployment.callablePackageId), 'OBJECT_ALIAS')
  uint(s.grant_capacity); uint(s.active_grant_count)
  check(BigInt(s.grant_capacity) <= 10000n && BigInt(s.active_grant_count) <= BigInt(s.grant_capacity)
    && s.active_grants.size === s.active_grant_ids.size, 'GRANT_COUNTS_INVALID')
  const q: SoulAccessQuote = { scopeMask: 0, capacity: null, priceAtomic: '0', feeAtomic: '0', totalAtomic: '0', feeRecipient: null, durationMs: null, expiresAtMs: null }
  const i = p.input, e = p.expected, grantAction = soulAccessIsGrant(p.action)
  check(typeof i.renew === 'boolean' && Array.isArray(i.paymentCoins) && i.paymentCoins.length <= 32, 'INVALID_INPUT')
  if (grantAction) {
    check(p.author === p.currentOwner && p.kind === null && p.granteeAddress !== null
      && p.granteeAddress !== p.author && e.descriptorBcs === null && e.marketConfigBcs === null
      && e.paidConfigBcs === null && e.buyerTableBcs === null && e.paidEntryBcs === null
      && typeof e.grantLive === 'boolean' && i.priceAtomic === null && i.durationMs === null
      && !i.renew && i.paymentCoins.length === 0, 'GRANT_INPUT_INVALID')
    id(p.granteeAddress)
    const slot = e.grantSlotBcs === null ? null : soulAccessBcs(SoulDetailStateBcs.GrantSlot, e.grantSlotBcs)
    if (slot) {
      id(slot.grant_id); scope(Number(slot.scope_mask))
      check(slot.version === '1' && slot.grantee === p.granteeAddress
        && BigInt(slot.ownership_epoch_snapshot) <= BigInt(p.ownershipEpoch) && !roots.includes(slot.grant_id), 'GRANT_SLOT_INVALID')
    }
    const currentEpoch = slot?.ownership_epoch_snapshot === p.ownershipEpoch
    const live = Boolean(currentEpoch && (slot!.expires_at_ms === null || BigInt(slot!.expires_at_ms) > BigInt(p.capturedAtMs)))
    check(live === e.grantLive, 'GRANT_LIVENESS_MISMATCH')
    if (p.action === 'grant-issue') {
      scope(i.scopeMask)
      if (i.expiresAtMs !== null) { uint(i.expiresAtMs, true); check(BigInt(i.expiresAtMs) > BigInt(p.capturedAtMs), 'GRANT_EXPIRED') }
      q.scopeMask = i.scopeMask | (live ? Number(slot!.scope_mask) : 0)
      // An expired same-epoch slot still counts on SoulState; issue cleans it
      // before replacing it. A stale-epoch row does not consume the count.
      const count = BigInt(s.active_grant_count) + (currentEpoch ? 0n : 1n)
      q.capacity = String(count > BigInt(s.grant_capacity) ? count : BigInt(s.grant_capacity))
      check(BigInt(q.capacity) <= 10000n, 'GRANT_CAPACITY_EXCEEDED'); q.expiresAtMs = i.expiresAtMs
    } else {
      check(live && slot && i.expiresAtMs === null, 'LIVE_GRANT_REQUIRED')
      q.capacity = s.grant_capacity
      if (p.action === 'grant-revoke') check(i.scopeMask === null, 'REVOKE_INPUT_INVALID')
      else {
        scope(i.scopeMask)
        const old = Number(slot.scope_mask), removed = old & i.scopeMask
        check(removed > 0 && removed !== old, 'PARTIAL_REVOKE_INVALID')
        q.scopeMask = old & ~i.scopeMask; q.expiresAtMs = slot.expires_at_ms
      }
    }
    return q
  }
  kind(p.kind)
  check(e.grantSlotBcs === null && e.grantLive === null && i.expiresAtMs === null, 'PAID_INPUT_INVALID')
  const descriptor = soulAccessBcs(SoulDetailStateBcs.Descriptor, e.descriptorBcs)
  check(descriptor.version === '1' && descriptor.kind === p.kind && (BigInt(descriptor.read_mode_mask) & 4n) !== 0n
    && [1n, 2n, 4n, 8n].includes(BigInt(descriptor.default_grant_scope_mask)), 'PAID_KIND_UNSUPPORTED')
  const config = e.paidConfigBcs === null ? null : soulAccessBcs(SoulDetailStateBcs.PaidConfig, e.paidConfigBcs)
  const buyer = e.buyerTableBcs === null ? null : soulAccessBcs(SoulDetailStateBcs.Table, e.buyerTableBcs)
  const entry = e.paidEntryBcs === null ? null : soulAccessBcs(SoulDetailStateBcs.PaidEntry, e.paidEntryBcs)
  if (config) check(config.version === '1' && config.scope_mask === descriptor.default_grant_scope_mask
    && BigInt(config.ownership_epoch_snapshot) <= BigInt(p.ownershipEpoch), 'PAID_CONFIG_INVALID')
  if (buyer) { id(buyer.id); check(BigInt(buyer.size) > 0n && !roots.includes(buyer.id), 'BUYER_TABLE_INVALID'); roots.push(buyer.id) }
  if (entry) check(buyer && entry.version === '1' && entry.scope_mask === descriptor.default_grant_scope_mask
    && BigInt(entry.ownership_epoch_snapshot) <= BigInt(p.ownershipEpoch), 'PAID_ENTRY_INVALID')
  let market: ReturnType<typeof SoulPublicMarketConfigBcs.parse> | null = null
  if (soulAccessUsesMarket(p.action)) {
    market = soulAccessBcs(SoulPublicMarketConfigBcs, e.marketConfigBcs)
    check(market.version === '2' && market.id === p.deployment.marketConfigId && market.primary_enabled
      && market.platform_fee_bps <= 10000, 'MARKET_UNAVAILABLE'); id(market.fee_recipient)
  } else check(e.marketConfigBcs === null, 'UNEXPECTED_MARKET')
  q.scopeMask = Number(descriptor.default_grant_scope_mask)
  if (p.action === 'paid-configure' || p.action === 'paid-update' || p.action === 'paid-delete') {
    check(p.author === p.currentOwner && p.granteeAddress === null && !buyer && !entry && !i.renew
      && i.paymentCoins.length === 0 && i.scopeMask === null, 'CONFIG_INPUT_INVALID')
    check(p.action === 'paid-configure' ? config === null : config !== null, 'CONFIG_EXISTENCE_CHANGED')
    if (p.action === 'paid-delete') check(i.priceAtomic === null && i.durationMs === null, 'DELETE_INPUT_INVALID')
    else {
      uint(i.priceAtomic); if (i.durationMs !== null) uint(i.durationMs)
      q.priceAtomic = i.priceAtomic
      q.durationMs = i.durationMs
    }
  } else if (p.action === 'paid-revoke') {
    check(p.author === p.currentOwner && p.granteeAddress !== null && entry && i.scopeMask === null
      && i.priceAtomic === null && i.durationMs === null && !i.renew && i.paymentCoins.length === 0, 'PAID_REVOKE_INPUT_INVALID')
    id(p.granteeAddress, false)
  } else {
    check(p.action === 'paid-purchase' && p.author !== p.currentOwner && p.granteeAddress === p.author
      && config && config.ownership_epoch_snapshot === p.ownershipEpoch && i.scopeMask === null
      && i.priceAtomic === null && i.durationMs === null, 'PURCHASE_INPUT_INVALID')
    uint(config.price_atomic, true)
    if (config.duration_ms !== null) uint(config.duration_ms)
    const sameEpoch = entry?.ownership_epoch_snapshot === p.ownershipEpoch
    check(!sameEpoch || entry!.expires_at_ms !== null, 'ALREADY_HAS_LIFETIME_ACCESS')
    check(i.renew === Boolean(sameEpoch), 'EXPLICIT_RENEWAL_REQUIRED')
    q.priceAtomic = config.price_atomic
    q.durationMs = config.duration_ms
    q.feeAtomic = String((BigInt(config.price_atomic) * BigInt(market!.platform_fee_bps) + 9999n) / 10000n)
    const total = BigInt(q.priceAtomic) + BigInt(q.feeAtomic)
    check(total <= SOUL_ACCESS_MAX, 'QUOTE_OVERFLOW'); q.totalAtomic = String(total); q.feeRecipient = market!.fee_recipient
    q.expiresAtMs = soulAccessPurchaseExpiry(config.duration_ms, sameEpoch ? entry!.expires_at_ms : null, p.capturedAtMs)
    check(!requireCoins || i.paymentCoins.length > 0, 'PAYMENT_REQUIRED')
    const seen = new Set<string>(); let balance = 0n
    for (const coin of i.paymentCoins) {
      exact(coin, ['objectId', 'version', 'digest', 'balance']); id(coin.objectId); uint(coin.version, true); uint(coin.balance, true); soulAccessDigest(coin.digest)
      check(!seen.has(coin.objectId) && !roots.includes(coin.objectId) && coin.objectId !== p.deployment.originalPackageId
        && coin.objectId !== p.deployment.callablePackageId, 'PAYMENT_ALIAS'); seen.add(coin.objectId); balance += BigInt(coin.balance)
    }
    check(balance <= SOUL_ACCESS_MAX && (!requireCoins || balance >= total), 'PAYMENT_AMOUNT_INVALID')
  }
  return q
}
export function soulAccessPurchaseExpiry(duration: string | null, previous: string | null, clock: string): string | null {
  uint(clock); if (duration === null) return null
  uint(duration); if (previous !== null) uint(previous)
  const base = previous !== null && BigInt(previous) > BigInt(clock) ? BigInt(previous) : BigInt(clock)
  const expiry = base + BigInt(duration); check(expiry <= SOUL_ACCESS_MAX, 'EXPIRY_OVERFLOW'); return String(expiry)
}
function parsePlan(input: unknown, requireCoins: boolean): SoulAccessPlan {
  const p = structuredClone(input) as SoulAccessPlan
  exact(p, ['deployment', 'soulId', 'stateId', 'contentId', 'paidAccessListId', 'author', 'currentOwner', 'ownershipEpoch',
    'capturedAtMs', 'action', 'kind', 'granteeAddress', 'expected', 'input', 'quote'])
  p.deployment = parseSoulAccessDeployment(p.deployment)
  ;[p.soulId, p.stateId, p.contentId, p.paidAccessListId, p.author, p.currentOwner].forEach(value => id(value))
  uint(p.ownershipEpoch); uint(p.capturedAtMs)
  check(['grant-issue', 'grant-revoke', 'grant-revoke-scope', 'paid-configure', 'paid-update', 'paid-delete', 'paid-purchase', 'paid-revoke'].includes(p.action), 'INVALID_ACTION')
  exact(p.expected, ['stateBcs', 'paidBcs', 'marketConfigBcs', 'descriptorBcs', 'grantSlotBcs', 'grantLive', 'paidConfigBcs', 'buyerTableBcs', 'paidEntryBcs'])
  exact(p.input, ['scopeMask', 'expiresAtMs', 'priceAtomic', 'durationMs', 'renew', 'paymentCoins'])
  exact(p.quote, ['scopeMask', 'capacity', 'priceAtomic', 'feeAtomic', 'totalAtomic', 'feeRecipient', 'durationMs', 'expiresAtMs'])
  const quote = deriveQuote(p, requireCoins)
  check(Object.keys(quote).every(key => quote[key as keyof SoulAccessQuote] === p.quote[key as keyof SoulAccessQuote]), 'QUOTE_MISMATCH')
  p.quote = quote
  return soulAccessFreeze(p)
}
export function parseSoulAccessPlan(input: unknown): SoulAccessPlan { return parsePlan(input, true) }
export function createSoulAccessPlan({ state, request }: { state: SoulAccessState; request: SoulAccessRequest }): SoulAccessPlan {
  return makePlan(state, request, true)
}
/** Internal draft is never persisted or signed; async prepare fills coin refs. */
export function makeSoulAccessQuoteDraft(state: SoulAccessState, request: SoulAccessRequest) { return makePlan(state, request, false) }
function makePlan(inputState: SoulAccessState, inputRequest: SoulAccessRequest, requireCoins: boolean): SoulAccessPlan {
  const state = structuredClone(inputState), request = structuredClone(inputRequest), s = state.snapshot
  check(request && typeof request === 'object' && !Array.isArray(request)
    && Object.keys(request).every(key => ['action', 'kind', 'granteeAddress', 'scopeMask', 'expiresAtMs', 'priceAtomic', 'durationMs', 'renew', 'paymentCoins'].includes(key)), 'INVALID_REQUEST')
  const isGrant = soulAccessIsGrant(request.action), selectedKind = request.kind ?? null
  const grantee = request.action === 'paid-purchase' ? state.author : request.granteeAddress ?? null
  if (request.action === 'paid-purchase') check(request.granteeAddress === undefined || request.granteeAddress === state.author, 'BUYER_MISMATCH')
  const slot = s.grants.find(row => row.slot.grantee === grantee)?.slot ?? null
  const paidConfig = s.paidAccessKindConfigs.find(row => row.kind === selectedKind)?.config ?? null
  const paidEntry = s.paidAccessEntries.find(row => row.buyerAddress === grantee && row.kind === selectedKind)?.entry ?? null
  const buyerOperation = request.action === 'paid-purchase' || request.action === 'paid-revoke'
  if (buyerOperation) check(state.buyerAddress === grantee, 'BUYER_OBSERVATION_REQUIRED')
  if (!isGrant) check(state.kind === selectedKind && state.descriptorBcs !== null, 'KIND_OBSERVATION_REQUIRED')
  const plan: SoulAccessPlan = {
    deployment: state.deployment, soulId: state.soulId, stateId: state.stateId, contentId: state.contentId,
    paidAccessListId: state.paidAccessListId, author: state.author, currentOwner: s.currentOwner,
    ownershipEpoch: s.ownershipEpoch, capturedAtMs: s.observedAtMs, action: request.action, kind: selectedKind, granteeAddress: grantee,
    expected: { stateBcs: state.stateBcs, paidBcs: state.paidBcs,
      marketConfigBcs: soulAccessUsesMarket(request.action) ? state.marketConfigBcs : null,
      descriptorBcs: isGrant ? null : state.descriptorBcs,
      grantSlotBcs: isGrant && slot ? SoulDetailStateBcs.GrantSlot.serialize(slot).toBase64() : null,
      grantLive: isGrant ? Boolean(slot && slot.ownership_epoch_snapshot === s.ownershipEpoch
        && (slot.expires_at_ms === null || BigInt(slot.expires_at_ms) > BigInt(s.observedAtMs))) : null,
      paidConfigBcs: !isGrant && paidConfig ? SoulDetailStateBcs.PaidConfig.serialize(paidConfig).toBase64() : null,
      buyerTableBcs: buyerOperation ? state.buyerTableBcs : null,
      paidEntryBcs: buyerOperation && paidEntry ? SoulDetailStateBcs.PaidEntry.serialize(paidEntry).toBase64() : null },
    input: { scopeMask: request.scopeMask ?? null, expiresAtMs: request.expiresAtMs ?? null, priceAtomic: request.priceAtomic ?? null,
      durationMs: request.durationMs ?? null, renew: request.renew ?? false, paymentCoins: request.paymentCoins ?? [] },
    quote: { scopeMask: 0, capacity: null, priceAtomic: '0', feeAtomic: '0', totalAtomic: '0', feeRecipient: null, durationMs: null, expiresAtMs: null },
  }
  plan.quote = deriveQuote(plan, requireCoins)
  return parsePlan(plan, requireCoins)
}
export function soulAccessKey(input: SoulAccessPlan): string {
  const p = parseSoulAccessPlan(input), d = p.deployment
  return `soulidity.soul-access:${d.chainIdentifier}:${d.originalPackageId}:${d.callablePackageId}:${d.marketConfigId}:${d.kindRegistryId}:${p.soulId}:${p.author}`
}

/** Compare only the exact contract preconditions. Unrelated config/other-kind
 * writes do not rewrite this intent; Clock advancement is expected, not drift. */
export function assertSoulAccessAuthority(input: SoulAccessPlan, observed: SoulAccessState): void {
  const p = parseSoulAccessPlan(input), s = observed.snapshot
  check(soulAccessSame(p.deployment, observed.deployment) && p.soulId === observed.soulId && p.stateId === observed.stateId
    && p.contentId === observed.contentId && p.paidAccessListId === observed.paidAccessListId && p.author === observed.author
    && p.currentOwner === s.currentOwner && p.ownershipEpoch === s.ownershipEpoch, 'AUTHORITY_CHANGED')
  const request: SoulAccessRequest = { action: p.action, ...(p.kind === null ? {} : { kind: p.kind }),
    ...(p.granteeAddress === null ? {} : { granteeAddress: p.granteeAddress }),
    ...(p.input.scopeMask === null ? {} : { scopeMask: p.input.scopeMask }), expiresAtMs: p.input.expiresAtMs,
    ...(p.input.priceAtomic === null ? {} : { priceAtomic: p.input.priceAtomic }), durationMs: p.input.durationMs,
    renew: p.input.renew, paymentCoins: p.input.paymentCoins }
  const now = createSoulAccessPlan({ state: observed, request })
  const oldState = soulAccessBcs(SoulStatePublicBcs, p.expected.stateBcs)
  check(!soulAccessIsGrant(p.action) || s.grantCapacity === oldState.grant_capacity && s.activeGrantCount === oldState.active_grant_count, 'GRANT_COUNTS_CHANGED')
  for (const key of ['marketConfigBcs', 'descriptorBcs', 'grantSlotBcs', 'grantLive', 'paidConfigBcs', 'buyerTableBcs', 'paidEntryBcs'] as const) {
    check(now.expected[key] === p.expected[key], 'TARGET_CHANGED')
  }
  // Expiry is projected at observation time; actual execution must recompute
  // using its historical Clock. Price, fee and recipients never float.
  check(soulAccessSame({ ...now.quote, expiresAtMs: null }, { ...p.quote, expiresAtMs: null }), 'QUOTE_CHANGED')
}
export function observeSoulAccessPlan(input: SoulAccessPlan, observed: SoulAccessState): { status: 'MATCHES' | 'CHANGED'; reason?: string } {
  try { assertSoulAccessAuthority(input, observed); return { status: 'MATCHES' } }
  catch (error) { return { status: 'CHANGED', reason: error instanceof Error ? error.message : 'SOUL_ACCESS_OBSERVATION_FAILED' } }
}
