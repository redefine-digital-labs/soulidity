import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { createChainObjectDiscovery, profileReadStep, SoulPublicBcs, SoulStatePublicBcs,
  deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES,
  SoulStatePointerKeyV1Bcs, SoulStatePointerFieldV1Bcs, SOUL_PUBLIC_MAX_SOUL_BYTES, type SoulPublicSnapshot,
  SoulPublicKioskBcs, SoulPublicListingBcs, type SoulPublicListingClient,
  type ChainObjectDiscoveryPage, type ChainObjectDiscoveryOptions } from '@soulidity/sdk'

export interface BrowserSoulCustodyDeployment {
  originalPackageId: string; chainIdentifier: string; kioskRegistryId: string; personalKioskTypePackageId: string
}
export type BrowserSoulCustodyInput = Pick<SoulPublicSnapshot,
  'soulId' | 'stateId' | 'currentOwner' | 'kioskId' | 'stateVersion' | 'stateDigest' | 'listedIndividually'>
export interface BrowserSoulCustodySnapshot {
  listingId: string | null; personalKioskCapId: string | null; stateVersion: string; stateDigest: string
}
export interface BrowserSoulListingObservation {
  readonly objectId: string; readonly version: string; readonly digest: string
  readonly initialSharedVersion: string; readonly bcs: string
  readonly listing: ReturnType<typeof SoulPublicListingBcs.parse>
}
/** Opaque in-memory result of one complete, raw-verified type-scoped scan.
 * The source checkpoint only bounds discovery; it is not signing authority. */
export interface BrowserSoulListingScan {
  readonly status: 'COMPLETE'; readonly source: ChainObjectDiscoveryPage['source']
  readonly candidateIds: readonly string[]; readonly observations: readonly BrowserSoulListingObservation[]
}
export interface BrowserSoulListingDiscoveryPage {
  readonly candidateStatus: ChainObjectDiscoveryPage['page']['status']; readonly source: ChainObjectDiscoveryPage['source']
  readonly verifiedListingCandidates: number; readonly scan: BrowserSoulListingScan | null
}
const issuedScans = new WeakMap<BrowserSoulListingScan, { client: SoulPublicListingClient; lifetime: AbortSignal }>()
const A = bcs.Address, U = bcs.u64()
const Registry = bcs.struct('KioskRegistry', { id: A, version: U })
const OwnerKey = bcs.struct('PersonalKioskOwnerKey', { owner: A })
const Registration = bcs.struct('PersonalKioskRegistration', { version: U, kiosk_id: A, kiosk_cap_id: A })
const RegistrationField = bcs.struct('Field', { id: A, name: OwnerKey, value: Registration })
const PersonalCap = bcs.struct('PersonalKioskCap', { id: A, cap: bcs.option(bcs.struct('KioskOwnerCap', { id: A, for: A })) })
const MAX = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`BROWSER_SOUL_CUSTODY_${code}`) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'INVALID_DIGEST')
}
function decode<T extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function listingValue(candidateId: string, bytes: Uint8Array) {
  const candidate = decode(SoulPublicListingBcs, bytes)
  check(candidate.id === candidateId && ['1', '2', '8'].includes(candidate.version)
    && BigInt(candidate.price) > 0n && candidate.creator_royalty_bps <= 10000, 'LISTING_INVALID')
  for (const value of [candidate.soul_id, candidate.state_id, candidate.seller, candidate.seller_kiosk_id, candidate.creator]) id(value)
  if (candidate.collection_id !== null) id(candidate.collection_id)
  const cap = candidate.purchase_cap
  if (candidate.is_active) {
    check(cap && cap.kiosk_id === candidate.seller_kiosk_id && cap.item_id === candidate.soul_id
      && cap.min_price === '0', 'PURCHASE_CAP_MISMATCH')
    id(cap.id); check(![candidateId, candidate.state_id, candidate.soul_id, candidate.seller_kiosk_id].includes(cap.id), 'PURCHASE_CAP_MISMATCH')
  }
  return candidate
}
function listingSource(source: ChainObjectDiscoveryPage['source'], d: Pick<BrowserSoulCustodyDeployment, 'originalPackageId' | 'chainIdentifier'>) {
  check(source && source.chainIdentifier === d.chainIdentifier && source.authority === 'CANDIDATE_IDS_ONLY'
    && source.scope.packageId === d.originalPackageId && source.scope.type === `${d.originalPackageId}::market::SoulListing`
    && source.scope.owner?.kind === 'SHARED' && Object.keys(source.scope.owner).length === 1
    && Number.isSafeInteger(source.checkpoint) && source.checkpoint >= 0, 'LISTING_SCAN_SCOPE')
  const url = new URL(source.endpoint)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.href === source.endpoint, 'LISTING_SCAN_ENDPOINT')
}
function checkedScan(scan: BrowserSoulListingScan, client: SoulPublicListingClient,
  d: Pick<BrowserSoulCustodyDeployment, 'originalPackageId' | 'chainIdentifier'>) {
  const issuer = issuedScans.get(scan)
  check(issuer?.client === client && !issuer.lifetime.aborted && scan.status === 'COMPLETE', 'VERIFIED_LISTING_SCAN_REQUIRED')
  listingSource(scan.source, d)
  check(scan.candidateIds.length <= 10000 && new Set(scan.candidateIds).size === scan.candidateIds.length
    && scan.observations.length <= scan.candidateIds.length, 'LISTING_SCAN_COUNT')
  scan.candidateIds.forEach(id)
  const candidates = new Set(scan.candidateIds), observed = new Set<string>()
  for (const value of scan.observations) {
    check(candidates.has(value.objectId) && !observed.has(value.objectId), 'LISTING_SCAN_DUPLICATE')
    observed.add(value.objectId)
  }
  return scan
}

/** Scan all Listing candidates once, committing each raw-verified page together.
 * A cancelled cursor handoff is latched and retried, never advanced twice. Only
 * an exhausted scan produces the opaque token accepted by per-Soul custody. */
export function createBrowserSoulListingDiscovery(params: {
  client: SoulPublicListingClient; deployment: Pick<BrowserSoulCustodyDeployment, 'originalPackageId' | 'chainIdentifier'>
  discovery: Omit<ChainObjectDiscoveryOptions, 'scope' | 'expectedChainIdentifier' | 'fetch'>; signal: AbortSignal
}, dependencies: { fetch?: typeof globalThis.fetch } = {}) {
  const d = structuredClone(params.deployment), settings = structuredClone(params.discovery), client = params.client, lifetime = params.signal
  id(d.originalPackageId); check(/^[0-9a-f]{8}$/.test(d.chainIdentifier) && settings.maxObjects <= 10000, 'CONFIG_INVALID')
  lifetime.throwIfAborted()
  const type = `${d.originalPackageId}::market::SoulListing`
  const reader = createChainObjectDiscovery({ ...settings, expectedChainIdentifier: d.chainIdentifier,
    scope: { packageId: d.originalPackageId, type, owner: { kind: 'SHARED' } }, fetch: dependencies.fetch })
  const candidates: string[] = [], observations: BrowserSoulListingObservation[] = []
  let prior: ChainObjectDiscoveryPage | null = null, pending: ChainObjectDiscoveryPage | null = null
  let flight: Promise<ChainObjectDiscoveryPage> | null = null, busy = false, terminal = false
  async function raw(objectId: string, signal: AbortSignal): Promise<BrowserSoulListingObservation | null> {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const value = response.objects[0].result
    check(value.oneofKind === 'object' || value.oneofKind === 'error' && value.error.code === 5, 'OBJECT_UNAVAILABLE')
    if (value.oneofKind !== 'object') return null
    const row = structuredClone(value.object)
    check(row.objectId === objectId && row.objectType === type && typeof row.version === 'bigint' && row.version > 0n && row.version <= MAX,
      'OBJECT_IDENTITY_MISMATCH')
    digest(row.digest)
    check(row.owner?.kind === 3 && typeof row.owner.version === 'bigint' && row.owner.version > 0n && row.owner.version <= row.version, 'CUSTODY_MISMATCH')
    check(row.contents?.value instanceof Uint8Array && row.contents.value.length > 0 && row.contents.value.length <= 16384, 'BCS_BUDGET')
    return { objectId, version: String(row.version), digest: row.digest, initialSharedVersion: String(row.owner.version),
      bcs: toBase64(row.contents.value), listing: listingValue(objectId, row.contents.value) }
  }
  return Object.freeze({ async next({ signal: caller }: { signal?: AbortSignal } = {}): Promise<BrowserSoulListingDiscoveryPage> {
    lifetime.throwIfAborted(); caller?.throwIfAborted()
    check(!busy, 'LISTING_SCAN_BUSY'); check(!terminal, 'LISTING_SCAN_ENDED'); busy = true
    const controller = new AbortController(), signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(120000), ...(caller ? [caller] : [])])
    try {
      if (!pending) await profileReadStep(signal, () => {
        flight ??= reader.next({ signal }).then(page => { if (!lifetime.aborted) pending = page; return page }).finally(() => { flight = null })
        return flight
      })
      const page = pending; check(page, 'LISTING_PAGE_UNAVAILABLE'); listingSource(page.source, d)
      check(page.source.endpoint === settings.endpoint && (!prior || JSON.stringify(prior.source) === JSON.stringify(page.source))
        && page.page.pagesRead === (prior?.page.pagesRead ?? 0) + 1 && page.page.objectsRead === candidates.length + page.ids.length
        && page.page.objectsRead <= settings.maxObjects && page.ids.length <= settings.pageSize
        && ['PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(page.page.status), 'LISTING_SCAN_COUNT')
      const seen = new Set(candidates)
      for (const candidate of page.ids) { id(candidate); check(!seen.has(candidate), 'LISTING_SCAN_DUPLICATE'); seen.add(candidate) }
      const genesis = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
      digest(genesis); check(toHex(fromBase58(genesis).subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
      const accepted: Array<BrowserSoulListingObservation | null> = []; let position = 0
      await Promise.all(Array.from({ length: Math.min(4, page.ids.length) }, async () => {
        while (position < page.ids.length) {
          signal.throwIfAborted(); const index = position++, objectId = page.ids[index]
          const first = await raw(objectId, signal), second = await raw(objectId, signal)
          check(JSON.stringify(first) === JSON.stringify(second), 'CHANGED_RETRY'); accepted[index] = first
        }
      }))
      signal.throwIfAborted()
      candidates.push(...page.ids); observations.push(...accepted.filter((value): value is BrowserSoulListingObservation => value !== null))
      prior = page; pending = null; terminal = page.page.status !== 'PARTIAL'
      let scan: BrowserSoulListingScan | null = null
      if (page.page.status === 'COMPLETE') {
        scan = freeze({ status: 'COMPLETE' as const, source: structuredClone(page.source), candidateIds: [...candidates], observations: structuredClone(observations) })
        issuedScans.set(scan, { client, lifetime })
      }
      return freeze({ candidateStatus: page.page.status, source: structuredClone(page.source), verifiedListingCandidates: candidates.length, scan })
    } finally { controller.abort(); busy = false }
  } })
}

/** Read-only IDs for the detail composer, never transaction authorization.
 * Listing discovery must exhaust one bounded checkpoint scan; gRPC proves the
 * unique current match. The current Market permits one registered personal
 * Kiosk per owner and rebind requires the old Kiosk to be empty. Therefore a
 * nonempty Soul Kiosk cannot be silently replaced with another owned Kiosk.
 * Mutable raw objects are reread; this is not an atomic checkpoint snapshot. */
export async function readBrowserSoulCustody(params: {
  client: SoulPublicListingClient; deployment: BrowserSoulCustodyDeployment; snapshot: BrowserSoulCustodyInput
  viewer: string | null
  listingScan?: BrowserSoulListingScan
  discovery?: { endpoint: string; pageSize: number; maxPages: number; maxObjects: number }
  signal?: AbortSignal
}, dependencies: { fetch?: typeof globalThis.fetch } = {}): Promise<BrowserSoulCustodySnapshot> {
  const { deployment: d, snapshot: expected, viewer, discovery } = structuredClone({ deployment: params.deployment,
    snapshot: params.snapshot, viewer: params.viewer, discovery: params.discovery })
  for (const value of [d.originalPackageId, d.kioskRegistryId, d.personalKioskTypePackageId,
    expected.soulId, expected.stateId, expected.currentOwner, expected.kioskId]) id(value)
  if (viewer !== null) id(viewer)
  check(typeof d.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(d.chainIdentifier), 'CONFIG_INVALID')
  check(typeof expected.listedIndividually === 'boolean' && typeof expected.stateVersion === 'string'
    && /^[1-9][0-9]*$/.test(expected.stateVersion) && BigInt(expected.stateVersion) <= MAX, 'SNAPSHOT_INVALID')
  digest(expected.stateDigest)
  const sharedScan = params.listingScan === undefined ? null : checkedScan(params.listingScan, params.client, d)
  const signal = AbortSignal.any([AbortSignal.timeout(25000), ...(params.signal ? [params.signal] : []),
    ...(sharedScan ? [issuedScans.get(sharedScan)!.lifetime] : [])])
  const client = params.client, pkg = d.originalPackageId
  const genesis = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(genesis); check(toHex(fromBase58(genesis).subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
  type Raw = NonNullable<Awaited<ReturnType<SoulPublicListingClient['ledgerService']['getObject']>>['response']['object']>
  const reads = new Map<string, { type: string; kind: number; owner?: string; maximum: number; raw: Raw | null }>()
  async function read(objectId: string, type: string, kind: number, owner?: string, optional = false, maximum = 16384) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result.oneofKind === 'object' || optional && result.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    if (raw) {
      check(raw.objectId === objectId && raw.objectType === normalizeStructTag(type) && typeof raw.version === 'bigint'
        && raw.version > 0n && raw.version <= MAX, 'OBJECT_IDENTITY_MISMATCH')
      digest(raw.digest)
      check(raw.owner?.kind === kind && (owner === undefined || raw.owner.address === owner)
        && (kind !== 3 || typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= raw.version), 'CUSTODY_MISMATCH')
      check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= maximum, 'BCS_BUDGET')
    }
    const prior = reads.get(objectId)
    if (prior) check(prior.type === type && prior.kind === kind && prior.owner === owner && (prior.raw === null ? raw === null
      : raw !== null && prior.raw.version === raw.version && prior.raw.digest === raw.digest
        && prior.raw.owner?.kind === raw.owner?.kind && prior.raw.owner?.address === raw.owner?.address
        && prior.raw.owner?.version === raw.owner?.version
        && toBase64(prior.raw.contents!.value!) === toBase64(raw.contents!.value!)), 'CHANGED_RETRY')
    else reads.set(objectId, { type, kind, owner, maximum, raw })
    return raw ? raw.contents!.value! : null
  }
  const state = decode(SoulStatePublicBcs, (await read(expected.stateId, `${pkg}::soul::SoulState`, 3))!)
  const stateRaw = reads.get(expected.stateId)!.raw!
  check(String(stateRaw.version) === expected.stateVersion && stateRaw.digest === expected.stateDigest, 'STALE_METADATA')
  check(state.id === expected.stateId && state.version === '1' && state.soul_id === expected.soulId
    && state.current_owner === expected.currentOwner && state.current_kiosk_id === expected.kioskId
    && state.is_listed === expected.listedIndividually && state.creator_royalty_bps <= 10000, 'STATE_MISMATCH')
  id(state.creator); if (state.collection_id !== null) id(state.collection_id)
  const itemFieldId = deriveKioskItemFieldId(expected.kioskId, expected.soulId)
  assertKioskItemField((await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, expected.kioskId, false, KIOSK_ITEM_FIELD_BYTES))!, expected.kioskId, expected.soulId)
  const soul = decode(SoulPublicBcs, (await read(expected.soulId, `${pkg}::soul::Soul`, 2, itemFieldId, false, SOUL_PUBLIC_MAX_SOUL_BYTES))!)
  check(soul.id === expected.soulId && soul.version === '1' && soul.creator === state.creator
    && [0, 1, 2, 3].includes(soul.provenance_kind), 'SOUL_MISMATCH')
  const stateKeyType = `${pkg}::soul::SoulStatePointerKeyV1`
  const statePointerId = deriveDynamicFieldID(soul.id, stateKeyType, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
  const statePointer = decode(SoulStatePointerFieldV1Bcs, (await read(statePointerId,
    `0x2::dynamic_field::Field<${stateKeyType},0x2::object::ID>`, 2, soul.id, false, 65))!)
  check(statePointer.id === statePointerId && statePointer.name.version === 1 && statePointer.value === state.id, 'STATE_POINTER_MISMATCH')
  const kiosk = decode(SoulPublicKioskBcs, (await read(expected.kioskId, '0x2::kiosk::Kiosk', 3))!)
  check(kiosk.id === expected.kioskId && kiosk.owner === expected.currentOwner && kiosk.item_count > 0, 'KIOSK_MISMATCH')

  let listingId: string | null = null, personalKioskCapId: string | null = null
  if (state.is_listed) {
    const type = `${pkg}::market::SoulListing`
    check(sharedScan || discovery, 'DISCOVERY_REQUIRED')
    const session = sharedScan ? null : createChainObjectDiscovery({ ...discovery!, expectedChainIdentifier: d.chainIdentifier,
      scope: { packageId: pkg, type, owner: { kind: 'SHARED' } }, timeoutMs: 25000, fetch: dependencies.fetch })
    while (true) {
      const page = session ? await profileReadStep(signal, () => session.next({ signal })) : null
      check(!page || page.page.status !== 'LIMIT_REACHED', 'DISCOVERY_INCOMPLETE')
      const matching = sharedScan?.observations.filter(row => row.listing.is_active
        && (row.listing.soul_id === soul.id || row.listing.state_id === state.id))
      for (const candidateId of page?.ids ?? matching!.map(row => row.objectId)) {
        const bytes = await read(candidateId, type, 3, undefined, true)
        // A checkpoint candidate may have been destroyed since discovery. Only
        // the exact per-request gRPC NOT_FOUND is absence; all other errors fail.
        if (sharedScan) {
          const observed = matching!.find(row => row.objectId === candidateId)!, current = reads.get(candidateId)!.raw
          check(bytes && current && observed.version === String(current.version) && observed.digest === current.digest
            && observed.initialSharedVersion === String(current.owner?.version) && observed.bcs === toBase64(bytes), 'CHANGED_RETRY')
        }
        if (bytes === null) continue
        const candidate = listingValue(candidateId, bytes)
        if (!candidate.is_active || candidate.soul_id !== soul.id && candidate.state_id !== state.id) continue
        check(candidate.soul_id === soul.id && candidate.state_id === state.id && candidate.seller === state.current_owner
          && candidate.seller_kiosk_id === state.current_kiosk_id && candidate.creator === state.creator
          && candidate.creator_royalty_bps === state.creator_royalty_bps && candidate.collection_id === state.collection_id
          && candidate.version === (soul.provenance_kind === 3 ? '8' : '2'), 'LISTING_MISMATCH')
        check(listingId === null, 'LISTING_AMBIGUOUS'); listingId = candidateId
      }
      if (!page || page.page.status === 'COMPLETE') break
    }
    check(listingId !== null, sharedScan ? 'LISTING_SCAN_CHANGED_RESTART' : 'LISTING_NOT_FOUND')
  }
  if (viewer === expected.currentOwner) {
    const registry = decode(Registry, (await read(d.kioskRegistryId, `${pkg}::market::KioskRegistry`, 3))!)
    check(registry.id === d.kioskRegistryId && registry.version === '1', 'REGISTRY_MISMATCH')
    const keyType = `${pkg}::market::PersonalKioskOwnerKey`
    const fieldId = deriveDynamicFieldID(registry.id, keyType, OwnerKey.serialize({ owner: viewer }).toBytes())
    const field = decode(RegistrationField, (await read(fieldId,
      `0x2::dynamic_field::Field<${keyType},${pkg}::market::PersonalKioskRegistration>`, 2, registry.id))!)
    check(field.id === fieldId && field.name.owner === viewer && field.value.version === '1'
      && field.value.kiosk_id === expected.kioskId, 'REGISTRATION_MISMATCH')
    id(field.value.kiosk_cap_id)
    const bytes = await read(field.value.kiosk_cap_id, `${d.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, 1, viewer, true)
    if (bytes !== null) {
      const cap = decode(PersonalCap, bytes)
      check(cap.id === field.value.kiosk_cap_id && cap.cap && cap.cap.for === expected.kioskId, 'PERSONAL_CAP_MISMATCH')
      id(cap.cap.id); check(![cap.id, expected.kioskId].includes(cap.cap.id), 'PERSONAL_CAP_MISMATCH')
      personalKioskCapId = cap.id
    }
  }
  for (const [objectId, entry] of reads) await read(objectId, entry.type, entry.kind, entry.owner, entry.raw === null, entry.maximum)
  signal.throwIfAborted()
  return Object.freeze({ listingId, personalKioskCapId, stateVersion: expected.stateVersion, stateDigest: expected.stateDigest })
}
