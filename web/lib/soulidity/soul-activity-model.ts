import { bcs } from '@mysten/sui/bcs'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { quoteAnimacraftV8SoulSale, type SoulGrantScope, type SoulGrantStatus } from '@soulidity/sdk'
import type { ActivityCheckpointEvidence, ActivityDeployment, ActivityTransactionEvidence } from './activity-transaction-evidence'
import { chainDateIso } from './soul-detail-model'

const A = bcs.Address, U = bcs.u64()
/** Exact current Move event payloads. Historical JSON projections are not inputs. */
export const SoulActivityEventBcs = {
  SoulCreated: bcs.struct('SoulCreated', { soul_id: A, state_id: A, content_id: A, creator: A, owner: A, provenance_kind: bcs.u8() }),
  SoulOwnershipRotated: bcs.struct('SoulOwnershipRotated', { soul_id: A, previous_owner: A, new_owner: A, ownership_epoch: U }),
  SoulGrantIssued: bcs.struct('SoulGrantIssued', { grant_id: A, soul_id: A, issued_by: A, grantee: A, scope_mask: U, expires_at_ms: bcs.option(U) }),
  SoulGrantRevoked: bcs.struct('SoulGrantRevoked', { grant_id: A, soul_id: A, revoked_by: A, grantee: A }),
  SoulGrantSuperseded: bcs.struct('SoulGrantSuperseded', { old_grant_id: A, new_grant_id: A, soul_id: A, grantee: A, superseded_by: A }),
  SoulGrantExpired: bcs.struct('SoulGrantExpired', { grant_id: A, soul_id: A, grantee: A }),
  SoulGrantDestroyed: bcs.struct('SoulGrantDestroyed', { grant_id: A, soul_id: A, grantee: A, destroyed_by: A }),
  SoulPurchased: bcs.struct('SoulPurchased', { listing_id: A, soul_id: A, seller: A, buyer: A,
    price: U, platform_fee: U, creator_royalty: U, collection_royalty: U }),
  AnimacraftV8SoulPurchased: bcs.struct('AnimacraftV8SoulPurchased', { listing_id: A, soul_id: A, provenance_id: A,
    seller: A, buyer: A, maker_source_recipient: A, price: U, seller_payout: U, protocol_fee: U,
    soul_creator_royalty_bps: bcs.u16(), soul_creator_royalty: U, maker_source_royalty_bps: bcs.u16(), maker_source_royalty: U }),
} as const
export type SoulActivityFamily = keyof typeof SoulActivityEventBcs
export const SOUL_ACTIVITY_FAMILIES = Object.freeze(Object.keys(SoulActivityEventBcs) as SoulActivityFamily[])
export type SoulActivityCoverage = Readonly<Record<SoulActivityFamily, 'UNSCANNED' | 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'>>
export function soulActivityEventType(originalPackageId: string, family: SoulActivityFamily): string {
  const moduleName = family.startsWith('SoulGrant') ? 'grant' : family.endsWith('Purchased') ? 'market' : 'soul'
  return `${originalPackageId}::${moduleName}::${family}`
}
type Payload<K extends SoulActivityFamily> = ReturnType<(typeof SoulActivityEventBcs)[K]['parse']>
type Position = { transactionDigest: string; checkpoint: string; timestampMs: string; transactionIndex: number; eventSequence: number }
type Event = { [K in SoulActivityFamily]: Position & { family: K; payload: Payload<K>; sender: string } }[SoulActivityFamily]
type Terminal = { status: Exclude<SoulGrantStatus, 'active'>; atMs: string; transactionDigest: string; eventSequence: number }

export interface ChainSoulGrantActivity {
  id: string; onChainId: string; soulOnChainId: string; issuedByAddress: string; granteeAddress: string
  scopes: SoulGrantScope[]; scopeMask: number; ownershipEpochSnapshot: string | null
  /** Null means lifecycle coverage is incomplete, never implicitly active. */
  status: SoulGrantStatus | null
  statusEvidence: 'INDEX_COMPLETE_AT_CHECKPOINT' | 'EXPLICIT_TERMINAL_EVENT' | 'UNAVAILABLE'
  createdAtMs: string; createdAt: string | null; expiresAtMs: string | null; expiresAt: string | null
  endedAtMs: string | null; endedAt: string | null; replacedByGrantOnChainId: string | null
  issuedTransactionDigest: string; issuedEventSequence: number
  endedTransactionDigest: string | null; endedEventSequence: number | null
  cleanupAtMs: string | null; destroyedAtMs: string | null
  observedAtMs: string; observedCheckpoint: string; notAuthorization: true
}
export interface ChainSoulPurchaseActivity {
  id: string; txDigest: string; eventSequence: number; soulOnChainId: string; soulName: null
  listingOnChainId: string; sellerAddress: string; buyerAddress: string
  model: 'BASE_PLUS_FEES' | 'GROSS_INCLUSIVE'
  paidAtomic: string; totalAtomic: string; platformFeeAtomic: string
  creatorRoyaltyAtomic: string; collectionRoyaltyAtomic: string; makerSourceRoyaltyAtomic: string | null
  /** Ordinary receipts do not identify all royalty recipients or the seller's
   * actual combined payout; do not fabricate that distribution. */
  sellerPayoutAtomic: string | null; makerSourceRecipient: string | null; provenanceId: string | null
  checkpoint: string; createdAtMs: string; createdAt: string | null; notAuthorization: true
}
export interface ChainSoulActivity {
  viewerAddress: string; deployment: ActivityDeployment; originalPackageId: string; checkpoint: string; observedAtMs: string
  grants: readonly ChainSoulGrantActivity[]; purchases: readonly ChainSoulPurchaseActivity[]
  coverage: SoulActivityCoverage; status: 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
  historyAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY'; completenessAuthority: 'BOUNDED_INDEX_COVERAGE'
  notAuthorization: true
}
const MAX = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_ACTIVITY_${code}`) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'ID_INVALID')
}
function uint(value: unknown) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX, 'INTEGER_INVALID')
  return BigInt(value)
}
function digest(value: unknown) {
  check(typeof value === 'string' && value.length <= 44, 'DIGEST_INVALID')
  const bytes = fromBase58(value)
  check(bytes.length === 32 && toBase58(bytes) === value, 'DIGEST_INVALID')
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function compare(a: Position, b: Position) {
  return uint(a.checkpoint) < uint(b.checkpoint) ? -1 : uint(a.checkpoint) > uint(b.checkpoint) ? 1
    : a.transactionIndex - b.transactionIndex || a.eventSequence - b.eventSequence
}

/** Payload decoding is downstream of actual transaction/checkpoint/type-origin
 * evidence, never a parser for GraphQL JSON. Event headers identify the top-level
 * call context and may legitimately be a third-party wrapper/module. */
function decodeEvents(transactions: readonly ActivityTransactionEvidence[], deployment: ActivityDeployment, checkpoint: string, timestampMs: string): Event[] {
  check(transactions.length <= 10000, 'TRANSACTION_LIMIT')
  const pkg = deployment.originalPackageId
  const names = new Map(SOUL_ACTIVITY_FAMILIES.map(family => [soulActivityEventType(pkg, family), family]))
  const seen = new Set<string>(), positions = new Set<string>(), times = new Map<string, string>(), events: Event[] = []
  let eventCount = 0
  for (const tx of transactions) {
    check(Object.keys(deployment).every(key => tx.deployment[key as keyof ActivityDeployment] === deployment[key as keyof ActivityDeployment])
      && tx.trust === 'TRUSTED_LEDGER_CANONICAL_EVIDENCE' && tx.notAuthorization === true
      && tx.eventAuthority === 'TYPE_ORIGIN_VERIFIED_HISTORY' && tx.executionPackageVersion === 'NOT_ATTESTED', 'TRANSACTION_SCOPE')
    digest(tx.transactionDigest)
    check(!seen.has(tx.transactionDigest), 'DUPLICATE_TRANSACTION'); seen.add(tx.transactionDigest)
    check(uint(tx.checkpoint) <= uint(checkpoint) && uint(tx.checkpointTimestampMs) <= uint(timestampMs)
      && Number.isSafeInteger(tx.transactionIndex) && tx.transactionIndex >= 0, 'POSITION_INVALID')
    check(tx.checkpoint !== checkpoint || tx.checkpointTimestampMs === timestampMs, 'CHECKPOINT_TIME_MISMATCH')
    const position = `${tx.checkpoint}:${tx.transactionIndex}`
    check(!positions.has(position), 'DUPLICATE_POSITION'); positions.add(position)
    check(!times.has(tx.checkpoint) || times.get(tx.checkpoint) === tx.checkpointTimestampMs, 'CHECKPOINT_TIME_MISMATCH')
    times.set(tx.checkpoint, tx.checkpointTimestampMs)
    check(Array.isArray(tx.events) && tx.events.length <= 10000, 'EVENT_LIMIT'); id(tx.sender)
    check((eventCount += tx.events.length) <= 100000, 'EVENT_LIMIT')
    for (const [index, raw] of tx.events.entries()) {
      check(raw.eventSequence === index && raw.sender === tx.sender, 'EVENT_POSITION')
      const family = names.get(raw.type)
      if (!family) continue
      check(typeof raw.contentsBytes === 'string' && raw.contentsBytes.length <= 1024, 'EVENT_BYTES')
      const bytes = fromBase64(raw.contentsBytes), schema = SoulActivityEventBcs[family], payload = schema.parse(bytes)
      check(toBase64(bytes) === raw.contentsBytes
        && toBase64(schema.serialize(payload as never).toBytes()) === raw.contentsBytes, 'EVENT_NONCANONICAL')
      for (const [key, value] of Object.entries(payload)) {
        if (key.endsWith('_id') || ['creator', 'owner', 'previous_owner', 'new_owner', 'issued_by', 'grantee', 'revoked_by',
          'superseded_by', 'destroyed_by', 'seller', 'buyer', 'maker_source_recipient'].includes(key)) id(value)
      }
      events.push({ family, payload, transactionDigest: tx.transactionDigest, checkpoint: tx.checkpoint,
        timestampMs: tx.checkpointTimestampMs, transactionIndex: tx.transactionIndex, eventSequence: index, sender: tx.sender } as Event)
    }
  }
  return events.sort(compare)
}

/** Replay an immutable, bounded history. COMPLETE denotes exhausted configured
 * index scans, not independently certified global ledger completeness. The
 * first explicit lifecycle termination wins; checkpoint time is NOT an input
 * Clock for earlier operations. Expiry is derived only at the final observation.
 * No current Soul/Grant existence, SQL membership or browser Date.now is used. */
export function composeSoulActivity(params: {
  viewerAddress: string; deployment: ActivityDeployment
  asOf: Pick<ActivityCheckpointEvidence, 'checkpoint' | 'timestampMs' | 'chainIdentifier' | 'trust' | 'notAuthorization'>
  transactions: readonly ActivityTransactionEvidence[]; coverage: SoulActivityCoverage
}): Readonly<ChainSoulActivity> {
  const { viewerAddress: viewer, deployment, asOf, transactions, coverage } = structuredClone(params), pkg = deployment.originalPackageId
  id(viewer); id(pkg); uint(asOf.checkpoint); uint(asOf.timestampMs)
  id(deployment.callablePackageId); digest(deployment.callableDigest)
  check(Object.keys(deployment).sort().join() === ['callableDigest', 'callablePackageId', 'chainIdentifier', 'originalPackageId'].sort().join()
    && /^[0-9a-f]{8}$/.test(deployment.chainIdentifier) && asOf.chainIdentifier === deployment.chainIdentifier
    && asOf.trust === 'TRUSTED_LEDGER_CANONICAL_EVIDENCE' && asOf.notAuthorization === true, 'OBSERVATION_SCOPE')
  check(Object.keys(coverage).length === SOUL_ACTIVITY_FAMILIES.length
    && SOUL_ACTIVITY_FAMILIES.every(f => ['UNSCANNED', 'PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(coverage[f])), 'COVERAGE_INVALID')
  const lifecycle = SOUL_ACTIVITY_FAMILIES.filter(f => !f.endsWith('Purchased'))
  const lifecycleComplete = lifecycle.every(f => coverage[f] === 'COMPLETE')
  const anchorsComplete = coverage.SoulCreated === 'COMPLETE' && coverage.SoulOwnershipRotated === 'COMPLETE'
  const owners = new Map<string, { epoch: string; owner: string }>()
  const grants = new Map<string, { entry: ChainSoulGrantActivity; position: Position; terminal: Terminal | null; destroyed: Event | null }>()
  const liveSlots = new Map<string, string>(), purchases: Array<{ entry: ChainSoulPurchaseActivity; position: Position }> = []
  const events = decodeEvents(transactions, deployment, asOf.checkpoint, asOf.timestampMs)
  const eventPositions = new Map(events.map(event => [`${event.transactionDigest}:${event.eventSequence}`, event]))
  const liveBySoul = new Map<string, Set<string>>()
  const purchaseRotations = new Map<string, Event[]>()
  const rotationKey = (tx: string, soulId: string, seller: string, buyer: string) => `${tx}:${soulId}:${seller}:${buyer}`
  const slot = (soulId: string, grantee: string) => `${soulId}:${grantee}`
  const terminate = (grantId: string, soulId: string, grantee: string, event: Event, status: Terminal['status']) => {
    const record = grants.get(grantId)
    if (!record) { check(!lifecycleComplete, 'MISSING_ISSUANCE'); return }
    check(record.entry.soulOnChainId === soulId && record.entry.granteeAddress === grantee, 'GRANT_RELATION')
    if (status === 'revoked' || status === 'superseded') check(!record.destroyed, 'DESTROYED_TERMINAL_CONFLICT')
    if (!record.terminal) record.terminal = { status, atMs: event.timestampMs, transactionDigest: event.transactionDigest, eventSequence: event.eventSequence }
    else if (lifecycleComplete && ['revoked', 'superseded'].includes(status)) check(false, 'TERMINAL_CONFLICT')
    if (liveSlots.get(slot(soulId, grantee)) === grantId) liveSlots.delete(slot(soulId, grantee))
    liveBySoul.get(soulId)?.delete(grantId)
  }
  for (const event of events) {
    const p = event.payload, owner = owners.get(p.soul_id)
    switch (event.family) {
      case 'SoulCreated': {
        const p = event.payload
        check(!owners.has(p.soul_id) && [0, 1, 2, 3].includes(p.provenance_kind)
          && new Set([p.soul_id, p.state_id, p.content_id]).size === 3, 'CREATION_INVALID')
        owners.set(p.soul_id, { epoch: '0', owner: p.owner }); break
      }
      case 'SoulOwnershipRotated': {
        const p = event.payload
        check(uint(p.ownership_epoch) > 0n, 'ROTATION_INVALID')
        if (anchorsComplete) check(owner && owner.owner === p.previous_owner && uint(p.ownership_epoch) === uint(owner.epoch) + 1n, 'ROTATION_GAP')
        owners.set(p.soul_id, { epoch: p.ownership_epoch, owner: p.new_owner })
        const key = rotationKey(event.transactionDigest, p.soul_id, p.previous_owner, p.new_owner)
        const rotations = purchaseRotations.get(key) ?? []; rotations.push(event); purchaseRotations.set(key, rotations)
        for (const grantId of [...(liveBySoul.get(p.soul_id) ?? [])])
          terminate(grantId, p.soul_id, grants.get(grantId)!.entry.granteeAddress, event, 'invalidated')
        break
      }
      case 'SoulGrantIssued': {
        const p = event.payload, mask = uint(p.scope_mask)
        check(!grants.has(p.grant_id) && p.grant_id !== p.soul_id && p.issued_by === event.sender
          && p.issued_by !== p.grantee && mask > 0n && mask <= 15n, 'ISSUANCE_INVALID')
        if (anchorsComplete) check(owner?.owner === p.issued_by, 'ISSUANCE_OWNER_GAP')
        if (p.expires_at_ms !== null) uint(p.expires_at_ms)
        if (lifecycleComplete) check(!liveSlots.has(slot(p.soul_id, p.grantee)), 'REPLACEMENT_EVENT_MISSING')
        const scopes = (['seal', 'memory', 'skills', 'assets'] as const).filter((_, bit) => (mask & (1n << BigInt(bit))) !== 0n)
        grants.set(p.grant_id, { position: event, terminal: null, destroyed: null, entry: {
          id: p.grant_id, onChainId: p.grant_id, soulOnChainId: p.soul_id, issuedByAddress: p.issued_by, granteeAddress: p.grantee,
          scopes, scopeMask: Number(mask), ownershipEpochSnapshot: anchorsComplete ? owner!.epoch : null,
          status: null, statusEvidence: 'UNAVAILABLE', createdAtMs: event.timestampMs, createdAt: chainDateIso(event.timestampMs),
          expiresAtMs: p.expires_at_ms, expiresAt: p.expires_at_ms === null ? null : chainDateIso(p.expires_at_ms),
          endedAtMs: null, endedAt: null, replacedByGrantOnChainId: null, issuedTransactionDigest: event.transactionDigest,
          issuedEventSequence: event.eventSequence, endedTransactionDigest: null, endedEventSequence: null,
          cleanupAtMs: null, destroyedAtMs: null, observedAtMs: asOf.timestampMs, observedCheckpoint: asOf.checkpoint, notAuthorization: true,
        } })
        liveSlots.set(slot(p.soul_id, p.grantee), p.grant_id)
        const live = liveBySoul.get(p.soul_id) ?? new Set<string>(); live.add(p.grant_id); liveBySoul.set(p.soul_id, live)
        break
      }
      case 'SoulGrantRevoked': {
        const p = event.payload
        check(p.revoked_by === event.sender, 'REVOKER_INVALID')
        if (anchorsComplete) check(owner?.owner === p.revoked_by, 'REVOKER_OWNER_GAP')
        terminate(p.grant_id, p.soul_id, p.grantee, event, 'revoked'); break
      }
      case 'SoulGrantSuperseded': {
        const p = event.payload
        check(p.superseded_by === event.sender && p.old_grant_id !== p.new_grant_id, 'SUPERSEDED_INVALID')
        if (anchorsComplete) check(owner?.owner === p.superseded_by, 'SUPERSEDED_OWNER_GAP')
        const replacement = eventPositions.get(`${event.transactionDigest}:${event.eventSequence + 1}`)
        check(replacement?.family === 'SoulGrantIssued' && replacement.payload.grant_id === p.new_grant_id
          && replacement.payload.soul_id === p.soul_id && replacement.payload.grantee === p.grantee
          && replacement.payload.issued_by === p.superseded_by, 'REPLACEMENT_ISSUANCE_MISSING')
        terminate(p.old_grant_id, p.soul_id, p.grantee, event, 'superseded')
        const old = grants.get(p.old_grant_id)
        if (old) old.entry.replacedByGrantOnChainId = p.new_grant_id
        break
      }
      case 'SoulGrantExpired': {
        const p = event.payload, row = grants.get(p.grant_id)
        if (row) {
          check(row.entry.expiresAtMs !== null && uint(row.entry.expiresAtMs) <= uint(asOf.timestampMs), 'EXPIRY_INVALID')
          check(!row.destroyed && row.entry.cleanupAtMs === null
            && (row.terminal === null || row.terminal.status === 'invalidated'), 'EXPIRY_TERMINAL_CONFLICT')
          row.entry.cleanupAtMs ??= event.timestampMs
        }
        terminate(p.grant_id, p.soul_id, p.grantee, event, 'expired'); break
      }
      case 'SoulGrantDestroyed': {
        const p = event.payload, row = grants.get(p.grant_id)
        check(p.destroyed_by === event.sender, 'DESTROYER_INVALID')
        if (!row) { check(!lifecycleComplete, 'MISSING_ISSUANCE'); break }
        check(row.entry.soulOnChainId === p.soul_id && row.entry.granteeAddress === p.grantee && !row.destroyed, 'DESTROY_RELATION')
        row.destroyed = event; row.entry.destroyedAtMs = event.timestampMs
        // Destruction alone does not identify revocation, supersession or epoch.
        if (liveSlots.get(slot(p.soul_id, p.grantee)) === p.grant_id) liveSlots.delete(slot(p.soul_id, p.grantee))
        liveBySoul.get(p.soul_id)?.delete(p.grant_id)
        break
      }
      case 'SoulPurchased':
      case 'AnimacraftV8SoulPurchased': {
        const p = event.payload
        check(p.buyer === event.sender && uint(p.price) > 0n && p.listing_id !== p.soul_id, 'PURCHASE_INVALID')
        if (anchorsComplete) {
          const rotations = purchaseRotations.get(rotationKey(event.transactionDigest, p.soul_id, p.seller, p.buyer))
          check(owner?.owner === p.buyer && rotations && rotations.length > 0, 'PURCHASE_ROTATION_MISSING')
          rotations.shift()
        }
        let total: bigint, platform: string, creator: string, collection: string, maker: string | null = null
        let payout: string | null = null, recipient: string | null = null, provenance: string | null = null
        if (event.family === 'SoulPurchased') {
          const p = event.payload
          platform = p.platform_fee; creator = p.creator_royalty; collection = p.collection_royalty
          const price = uint(p.price), fees = [uint(platform), uint(creator), uint(collection)]
          check(fees.every(fee => fee <= price) && fees.reduce((a, b) => a + b, 0n) <= price + 2n, 'PURCHASE_FEE_INVALID')
          total = uint(p.price) + uint(platform) + uint(creator) + uint(collection)
          check(total <= MAX, 'PURCHASE_OVERFLOW')
        } else {
          const p = event.payload
          const quote = quoteAnimacraftV8SoulSale(uint(p.price), { soulCreatorRoyaltyBps: p.soul_creator_royalty_bps, makerSourceRoyaltyBps: p.maker_source_royalty_bps })
          check(uint(p.protocol_fee) === quote.protocolFeeAtomic && uint(p.soul_creator_royalty) === quote.soulCreatorRoyaltyAtomic
            && uint(p.maker_source_royalty) === quote.makerSourceRoyaltyAtomic && uint(p.seller_payout) === quote.sellerPayoutAtomic, 'NATIVE_PURCHASE_QUOTE')
          total = uint(p.price); platform = p.protocol_fee; creator = p.soul_creator_royalty; collection = '0'
          maker = p.maker_source_royalty; payout = p.seller_payout; recipient = p.maker_source_recipient; provenance = p.provenance_id
        }
        purchases.push({ position: event, entry: { id: `${event.transactionDigest}:${event.eventSequence}`, txDigest: event.transactionDigest,
          eventSequence: event.eventSequence, soulOnChainId: p.soul_id, soulName: null, listingOnChainId: p.listing_id,
          sellerAddress: p.seller, buyerAddress: p.buyer, model: event.family === 'SoulPurchased' ? 'BASE_PLUS_FEES' : 'GROSS_INCLUSIVE',
          paidAtomic: p.price, totalAtomic: String(total), platformFeeAtomic: platform, creatorRoyaltyAtomic: creator,
          collectionRoyaltyAtomic: collection, makerSourceRoyaltyAtomic: maker, sellerPayoutAtomic: payout,
          makerSourceRecipient: recipient, provenanceId: provenance, checkpoint: event.checkpoint,
          createdAtMs: event.timestampMs, createdAt: chainDateIso(event.timestampMs), notAuthorization: true,
        } }); break
      }
    }
  }
  for (const row of grants.values()) {
    const entry = row.entry, terminal = row.terminal
    // An explicit revoke/supersession cannot follow an earlier valid termination
    // of that same Grant, so these two statuses are meaningful even mid-scan.
    const explicit = terminal && ['revoked', 'superseded'].includes(terminal.status)
    if (lifecycleComplete || explicit) {
      entry.status = terminal?.status ?? (entry.expiresAtMs !== null && uint(entry.expiresAtMs) <= uint(asOf.timestampMs) ? 'expired' : 'active')
      entry.statusEvidence = lifecycleComplete ? 'INDEX_COMPLETE_AT_CHECKPOINT' : 'EXPLICIT_TERMINAL_EVENT'
      if (terminal) {
        // Expiry's end instant is its recorded threshold, not cleanup's later tx.
        entry.endedAtMs = terminal.status === 'expired' ? entry.expiresAtMs : terminal.atMs
        entry.endedTransactionDigest = terminal.transactionDigest; entry.endedEventSequence = terminal.eventSequence
      } else if (entry.status === 'expired') entry.endedAtMs = entry.expiresAtMs
      entry.endedAt = entry.endedAtMs === null ? null : chainDateIso(entry.endedAtMs)
      check(!row.destroyed || entry.status !== 'active', 'DESTROYED_ACTIVE_CONTRADICTION')
    }
  }
  const values = Object.values(coverage)
  return freeze({ viewerAddress: viewer, deployment, originalPackageId: pkg, checkpoint: asOf.checkpoint, observedAtMs: asOf.timestampMs,
    grants: [...grants.values()].filter(row => row.entry.issuedByAddress === viewer || row.entry.granteeAddress === viewer)
      .sort((a, b) => compare(b.position, a.position)).map(row => row.entry),
    purchases: purchases.filter(row => row.entry.buyerAddress === viewer).sort((a, b) => compare(b.position, a.position)).map(row => row.entry),
    coverage, status: values.includes('LIMIT_REACHED') ? 'LIMIT_REACHED' : values.every(v => v === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL',
    historyAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', completenessAuthority: 'BOUNDED_INDEX_COVERAGE', notAuthorization: true })
}

/** Export the selected history rows, not SQL IDs or rounded calendar values. */
export function soulActivityGrantsCsv(grants: readonly ChainSoulGrantActivity[]): string {
  const header = ['grantId', 'soulId', 'status', 'statusEvidence', 'scopes', 'grantee', 'issuedBy', 'ownershipEpoch',
    'createdAtMs', 'expiresAtMs', 'endedAtMs', 'replacedByGrantId', 'issuedTx', 'issuedEventSequence', 'endedTx', 'observedCheckpoint']
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [header.join(','), ...grants.map(g => [g.onChainId, g.soulOnChainId, g.status ?? 'unavailable', g.statusEvidence,
    g.scopes.join('|'), g.granteeAddress, g.issuedByAddress, g.ownershipEpochSnapshot, g.createdAtMs, g.expiresAtMs,
    g.endedAtMs, g.replacedByGrantOnChainId, g.issuedTransactionDigest, g.issuedEventSequence, g.endedTransactionDigest,
    g.observedCheckpoint].map(quote).join(','))].join('\n')
}
