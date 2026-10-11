import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, normalizeTypeTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { assertSoulPublicDeployment, type SoulPublicDeployment } from './soul-public-read'
import { SoulPublicKioskBcs } from './soul-public-listing'
import { assertKioskItemField, deriveKioskItemFieldId, KioskItemBcs, KIOSK_ITEM_FIELD_TYPE } from './kiosk-item-custody'

export interface WalletKioskInventoryClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'batchGetObjects'>
  stateService: Pick<SuiGrpcClient['stateService'], 'listDynamicFields'>
}
export interface WalletKioskItemReference {
  readonly itemId: string; readonly fieldId: string; readonly type: string
  readonly version: string; readonly digest: string
}
export interface WalletKioskInventoryPage {
  readonly owner: string; readonly kioskId: string | null
  /** Registered ID is a discovery hint, not proof of an owned signing cap. */
  readonly registeredCapId: string | null
  readonly items: readonly WalletKioskItemReference[]
  readonly status: 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
  readonly expectedItemCount: number; readonly scannedFields: number; readonly pages: number
  readonly consistency: 'STABLE_KIOSK_MEMBERSHIP_PER_PAGE'
  readonly notAuthorization: true
}
export interface WalletKioskInventoryOptions {
  client: WalletKioskInventoryClient; deployment: SoulPublicDeployment & { kioskRegistryId: string }; owner: string
  pageSize?: number; maxPages?: number; maxFields?: number; maxItems?: number
}
const A = bcs.Address, U = bcs.u64(), MAX = 18446744073709551615n
const Registry = bcs.struct('KioskRegistry', { id: A, version: U })
const OwnerKey = bcs.struct('PersonalKioskOwnerKey', { owner: A })
const Registration = bcs.struct('Field', { id: A, name: OwnerKey, value: bcs.struct('PersonalKioskRegistration', {
  version: U, kiosk_id: A, kiosk_cap_id: A,
}) })
const ITEM_TYPE = normalizeStructTag('0x2::kiosk::Item')
type Raw = NonNullable<Awaited<ReturnType<WalletKioskInventoryClient['ledgerService']['batchGetObjects']>>['response']['objects'][number]['result']>
type ObjectRow = Extract<Raw, { oneofKind: 'object' }>['object']
type Anchor = { id: string; type: string; kind: number; owner?: string; maximum: number; value: ObjectRow | null }
type CandidatePage = Awaited<ReturnType<WalletKioskInventoryClient['stateService']['listDynamicFields']>>['response']
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`WALLET_KIOSK_${code}`) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
function type(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096, 'INVALID_TYPE')
  // normalizeTypeTag formats generics but does not normalize package addresses.
  // The BCS roundtrip does both, including nested vectors and primitive values.
  check(normalizeTypeTag(value).replace(/\s/g, '') === value.replace(/\s/g, ''), 'INVALID_TYPE')
  const validate = (tag: ReturnType<typeof TypeTagSerializer.parseFromStr>) => {
    if ('vector' in tag) validate(tag.vector)
    if ('struct' in tag) {
      check(/^0x[0-9a-fA-F]{1,64}$/.test(tag.struct.address)
        && [tag.struct.module, tag.struct.name].every(name => /^(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)$/.test(name)), 'INVALID_TYPE')
      tag.struct.typeParams.forEach(validate)
    }
  }
  validate(TypeTagSerializer.parseFromStr(value))
  return bcs.TypeTag.parse(bcs.TypeTag.serialize(value).toBytes()).replace(/, /g, ',')
}
function integer(value: number, maximum: number) { check(Number.isSafeInteger(value) && value > 0 && value <= maximum, 'INVALID_LIMIT'); return value }
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, row) => typeof row === 'bigint' ? String(row) : row instanceof Uint8Array ? toBase64(row) : row)
}
function decode<T extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(schema: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = schema.parse(bytes)
  check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}

/** Official gRPC returns the unwrapped Item name for dynamic-object discovery;
 * the actual field ID/type still uses Wrapper<Item>. A failed page is retained
 * for explicit retry. Membership changes require a new scan, not silent restart.
 * The resulting references must pass Soul/State or Collection/Right readers
 * before presentation; they never authorize transactions. */
export function createWalletKioskInventory(options: WalletKioskInventoryOptions) {
  const { kioskRegistryId, ...inputDeployment } = structuredClone(options.deployment)
  const deployment = assertSoulPublicDeployment(inputDeployment), owner = options.owner, client = options.client
  id(owner); id(kioskRegistryId)
  const pageSize = integer(options.pageSize ?? 50, 1000), maxPages = integer(options.maxPages ?? 200, 1000)
  const maxFields = integer(options.maxFields ?? 10000, 100000), maxItems = integer(options.maxItems ?? 2000, 10000)
  const registryType = `${deployment.originalPackageId}::market::KioskRegistry`
  const keyType = `${deployment.originalPackageId}::market::PersonalKioskOwnerKey`
  const registrationId = deriveDynamicFieldID(kioskRegistryId, keyType, OwnerKey.serialize({ owner }).toBytes())
  const registrationType = `0x2::dynamic_field::Field<${keyType},${deployment.originalPackageId}::market::PersonalKioskRegistration>`
  let anchors: Anchor[] | null = null, kioskId: string | null = null, registeredCapId: string | null = null
  let expectedItemCount = 0, pages = 0, scannedFields = 0, busy = false, ended = false
  let token: Uint8Array | undefined, pending: CandidatePage | null = null
  const tokens = new Set<string>(), fields = new Set<string>(), items = new Map<string, WalletKioskItemReference>()
  function result(status: WalletKioskInventoryPage['status']): WalletKioskInventoryPage {
    return Object.freeze({ owner, kioskId, registeredCapId, items: Object.freeze([...items.values()].map(row => Object.freeze({ ...row }))),
      status, expectedItemCount, scannedFields, pages, consistency: 'STABLE_KIOSK_MEMBERSHIP_PER_PAGE', notAuthorization: true })
  }
  return Object.freeze({ async next({ signal: parentSignal }: { signal?: AbortSignal } = {}): Promise<WalletKioskInventoryPage> {
    check(!busy, 'BUSY'); check(!ended, 'SCAN_ENDED'); parentSignal?.throwIfAborted(); busy = true
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000), ...(parentSignal ? [parentSignal] : [])])
    let readBytes = 0
    const request = async (objectId: string, expectedType: string | null, kind: number, parent?: string, optional = false, maximum = 256 * 1024) => {
      id(objectId)
      const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
        readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } }, { abort: signal }))
      check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
      const row = response.objects[0].result
      if (row.oneofKind === 'error' && row.error.code === 5 && optional) return null
      check(row.oneofKind === 'object', 'OBJECT_UNAVAILABLE')
      const value = structuredClone(row.object)
      check(value.objectId === objectId && typeof value.version === 'bigint' && value.version > 0n && value.version <= MAX, 'OBJECT_REFERENCE_INVALID')
      check(typeof value.digest === 'string' && fromBase58(value.digest).length === 32 && toBase58(fromBase58(value.digest)) === value.digest, 'DIGEST_INVALID')
      const observedType = type(value.objectType)
      check(expectedType === null || observedType === type(expectedType), 'TYPE_MISMATCH')
      check(value.owner?.kind === kind && (parent === undefined || value.owner.address === parent)
        && (kind !== 3 || typeof value.owner.version === 'bigint' && value.owner.version > 0n && value.owner.version <= value.version), 'CUSTODY_MISMATCH')
      check(value.contents?.value instanceof Uint8Array && value.contents.value.length >= 32 && value.contents.value.length <= maximum, 'BCS_BUDGET')
      check((readBytes += value.contents.value.length) <= 32 * 1024 * 1024, 'READ_BUDGET')
      check(bcs.Address.parse(value.contents.value.subarray(0, 32)) === objectId, 'OBJECT_UID_MISMATCH')
      return value
    }
    const recheck = async (rows: Anchor[], restart: boolean) => {
      for (const row of rows) {
        const next = await request(row.id, row.type, row.kind, row.owner, row.value === null, row.maximum)
        check(fingerprint(next) === fingerprint(row.value), restart ? 'MEMBERSHIP_CHANGED_RESTART' : 'CHANGED_RETRY')
      }
    }
    try {
      const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier())
      const genesis = fromBase58(chainIdentifier)
      check(genesis.length === 32 && toBase58(genesis) === chainIdentifier && toHex(genesis.subarray(0, 4)) === deployment.chainIdentifier, 'WRONG_CHAIN')
      if (!anchors) {
        const registry = (await request(kioskRegistryId, registryType, 3, undefined, false, 40))!
        const decodedRegistry = decode(Registry, registry.contents!.value!)
        check(decodedRegistry.id === kioskRegistryId && decodedRegistry.version === '1', 'REGISTRY_INVALID')
        const registration = await request(registrationId, registrationType, 2, kioskRegistryId, true, 136)
        const roots: Anchor[] = [{ id: kioskRegistryId, type: registryType, kind: 3, maximum: 40, value: registry },
          { id: registrationId, type: registrationType, kind: 2, owner: kioskRegistryId, maximum: 136, value: registration }]
        if (registration === null) {
          await recheck(roots, false); signal.throwIfAborted(); anchors = roots; ended = true
          return result('COMPLETE')
        }
        const registered = decode(Registration, registration.contents!.value!)
        check(registered.id === registrationId && registered.name.owner === owner && registered.value.version === '1', 'REGISTRATION_INVALID')
        id(registered.value.kiosk_id); id(registered.value.kiosk_cap_id)
        check(new Set([kioskRegistryId, registrationId, registered.value.kiosk_id, registered.value.kiosk_cap_id]).size === 4, 'OBJECT_ALIAS')
        const kiosk = (await request(registered.value.kiosk_id, '0x2::kiosk::Kiosk', 3, undefined, false, 77))!
        const decodedKiosk = decode(SoulPublicKioskBcs, kiosk.contents!.value!)
        check(decodedKiosk.id === registered.value.kiosk_id && decodedKiosk.owner === owner, 'KIOSK_OWNER_MISMATCH')
        roots.push({ id: decodedKiosk.id, type: '0x2::kiosk::Kiosk', kind: 3, maximum: 77, value: kiosk })
        await recheck(roots, false); signal.throwIfAborted()
        anchors = roots; kioskId = decodedKiosk.id; registeredCapId = registered.value.kiosk_cap_id; expectedItemCount = decodedKiosk.item_count
      } else await recheck(anchors, true)
      check(kioskId !== null, 'KIOSK_REQUIRED')
      if (!pending) pending = structuredClone((await profileReadStep(signal, () => client.stateService.listDynamicFields({
        parent: kioskId!, pageSize, ...(token ? { pageToken: token } : {}),
        readMask: { paths: ['parent', 'field_id', 'name', 'value_type', 'kind', 'child_id'] },
      }, { abort: signal }))).response)
      const page = pending
      check(Array.isArray(page.dynamicFields) && page.dynamicFields.length <= pageSize, 'PAGE_INVALID')
      const next = page.nextPageToken
      check(next === undefined || next instanceof Uint8Array && next.length <= 4096, 'CURSOR_INVALID')
      const nextToken = next && next.length ? toBase64(next) : null
      check(nextToken === null || !tokens.has(nextToken), 'CURSOR_NOT_ADVANCING')
      const localFields = new Set<string>(), localItems = new Map<string, WalletKioskItemReference>(), verified: Anchor[] = []
      if (scannedFields + page.dynamicFields.length > maxFields) { ended = true; return result('LIMIT_REACHED') }
      for (const candidate of page.dynamicFields) {
        id(candidate.fieldId)
        check(candidate.parent === kioskId && [1, 2].includes(candidate.kind ?? 0) && candidate.name?.value instanceof Uint8Array
          && candidate.name.value.length <= 8192 && !fields.has(candidate.fieldId) && !localFields.has(candidate.fieldId), 'CANDIDATE_INVALID')
        localFields.add(candidate.fieldId)
        const name = type(candidate.name.name), valueType = type(candidate.valueType)
        if (name !== ITEM_TYPE) continue
        check(candidate.kind === 2, 'ITEM_KIND_INVALID')
        check('struct' in TypeTagSerializer.parseFromStr(valueType), 'ITEM_TYPE_INVALID')
        const key = decode(KioskItemBcs, candidate.name.value); id(key.id)
        const fieldId = deriveKioskItemFieldId(kioskId, key.id)
        check(candidate.childId === key.id && candidate.fieldId === fieldId && !items.has(key.id) && !localItems.has(key.id), 'ITEM_CANDIDATE_MISMATCH')
        if (items.size + localItems.size === maxItems) { ended = true; return result('LIMIT_REACHED') }
        const field = (await request(fieldId, KIOSK_ITEM_FIELD_TYPE, 2, kioskId, false, 96))!
        assertKioskItemField(field.contents!.value!, kioskId, key.id)
        const child = (await request(key.id, valueType, 2, fieldId))!
        verified.push({ id: fieldId, type: KIOSK_ITEM_FIELD_TYPE, kind: 2, owner: kioskId, maximum: 96, value: field },
          { id: key.id, type: valueType, kind: 2, owner: fieldId, maximum: 256 * 1024, value: child })
        localItems.set(key.id, { itemId: key.id, fieldId, type: valueType, version: String(child.version), digest: child.digest! })
      }
      check(items.size + localItems.size <= expectedItemCount, 'ITEM_COUNT_MISMATCH')
      if (nextToken === null) check(items.size + localItems.size === expectedItemCount, 'ITEM_COUNT_MISMATCH')
      await recheck(verified, false); await recheck(anchors, true); signal.throwIfAborted()
      for (const fieldId of localFields) fields.add(fieldId)
      for (const [itemId, item] of localItems) items.set(itemId, item)
      scannedFields += page.dynamicFields.length; pages++; pending = null
      if (nextToken !== null) { tokens.add(nextToken); token = Uint8Array.from(next!) }
      const status = nextToken === null ? 'COMPLETE' : pages >= maxPages ? 'LIMIT_REACHED' : 'PARTIAL'
      ended = status !== 'PARTIAL'; return result(status)
    } finally { controller.abort(); busy = false }
  } })
}
