import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { nativePublicOwnerSourceKeyV2, readNativePublicReadRecordV2 } from '../native-public-read-record-v2'
import type { CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { NativeInitialAuthorizationBcs, NativeInitialPaidBcs } from '../native-initial-children'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject, readEconomicsIncome, type EconomicsTarget } from './economics-read'
import { recoverEconomicsHistoricalGates } from './economics-bcs'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, paidContentDecision, quoteNativePaidContent } from './paid-content-policy'

const Link = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
const OfferField = bcs.struct('Field', { id: bcs.Address, name: bcs.u32(), value: PaidContentOfferBcs })
const EntryField = bcs.struct('Field', { id: bcs.Address, name: PaidContentBuyerKeyBcs, value: PaidContentEntryBcs })
const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })
const clockId = `0x${'6'.padStart(64, '0')}`

/** Explicit current HostV2 qualification preview. Reads actual Record and the
 * sole embedded State UID's actual Auth/Paid children; never requests State as
 * a v1 ObjectOwned object. Reusable qualification needs no Offer, Config gate,
 * SourceService or Account. Actual Seal policy execution remains authority.
 * Candidate source/format adoption and parent-commit qualification are required
 * before enabling a product release. No pay/sign/decrypt or durable success.
 */
export async function readNativePublicReadPaidV2(input: { format: 'native-public-read-v2'; client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget;
  economics?: EconomicsTarget; expectedSourceKey?: string; soulId: string; buyer: string; kind: number; recordIndex: number; requiredScope: bigint; signal: AbortSignal }) {
  const { soulId, buyer, kind, recordIndex, requiredScope, expectedSourceKey } = input, target = structuredClone(input.target), economics = structuredClone(input.economics)
  const source = input.client
  const client = { core: { getChainIdentifier: source.core.getChainIdentifier.bind(source.core) }, ledgerService: { getObject: source.ledgerService.getObject.bind(source.ledgerService) } } as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  commerceCheck(input.format === 'native-public-read-v2' && commerceId(buyer) && target.content
    && (!economics || target.configId === economics.configId && target.chainIdentifier === economics.chainIdentifier)
    && Number.isSafeInteger(kind) && kind >= 0 && kind <= 0xffffffff && Number.isSafeInteger(recordIndex) && recordIndex >= 0 && recordIndex < 4096
    && typeof requiredScope === 'bigint' && requiredScope > 0n, 'PUBLIC_PAID_V2_READ_INPUT')
  const view = await readNativePublicReadRecordV2({ client, target, soulId, recordIndex, signal })
  commerceCheck(view.format === 'native-public-read-v2' && view.record.kind === kind && BigInt(view.record.scope) === requiredScope, 'PUBLIC_PAID_V2_READ_SCOPE_CHANGED')
  commerceCheck(expectedSourceKey === undefined || expectedSourceKey === nativePublicOwnerSourceKeyV2(view, {
    index: recordIndex, kind: view.record.kind, name: view.record.name, version: view.record.version,
  }), 'PUBLIC_PAID_V2_READ_OVERVIEW_CHANGED_REFRESH')
  const native = await readPinnedMovePackage(client, target.native, signal), content = await readPinnedMovePackage(client, target.content, signal)
  const link = native.linkage.get(content.pin.originalPackageId)
  commerceCheck(link?.upgradedId === content.pin.callablePackageId && link.upgradedVersion === String(content.version), 'PUBLIC_PAID_V2_READ_CONTENT_LINK')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PUBLIC_PAID_V2_READ_ORIGIN'); return `${origin}::${module}::${name}` }
  const observations: Array<{ id: string; type: string; version: string; digest: string }> = []
  async function read(id: string, expected: string) {
    const row = await readCommerceObject(client, id, expected, signal); observations.push({ id, type: expected, version: row.version, digest: row.digest }); return row
  }
  async function child(name: string, expected: string) {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${type(native.origins, 'birth', name)}>`, id = deriveDynamicFieldID(view.stateId, wrapper, moveEmptyStructBytes())
    const pointer = await read(id, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`), field = decodeCommerce(Link, pointer.contents)
    commerceCheck(pointer.owner.ObjectOwner === view.stateId && field.id === id && !field.name.name.dummy_field, 'PUBLIC_PAID_V2_READ_CHILD_POINTER')
    const value = await read(field.value, expected)
    commerceCheck(value.owner.ObjectOwner === id, 'PUBLIC_PAID_V2_READ_CHILD_OWNER'); return value
  }
  const authObject = await child('AuthorizationKey', type(content.origins, 'authorization', 'Authorization')), auth = decodeCommerce(NativeInitialAuthorizationBcs, authObject.contents)
  const ledgerObject = await child('PaidKey', type(content.origins, 'paid_access', 'Ledger')), ledger = decodeCommerce(NativeInitialPaidBcs, ledgerObject.contents)
  commerceCheck(auth.id === authObject.objectId && ledger.id === ledgerObject.objectId && ledger.protocol === target.configId, 'PUBLIC_PAID_V2_READ_LEDGER')
  for (const value of [auth, ledger]) commerceCheck(value.root === soulId && value.controller.root === soulId && value.controller.parent === view.stateId
    && normalizeStructTag(value.controller.operator.name) === type(native.origins, 'birth', 'ContentOperator'), 'PUBLIC_PAID_V2_READ_CONTROLLER')
  const ids = [view.soulId, view.hostId, view.stateId, view.contentId, auth.id, ledger.id, auth.grants.id, ledger.offers.id, ledger.entries.id, ledger.attempts.id]
  commerceCheck(ids.every(commerceId) && new Set(ids).size === ids.length, 'PUBLIC_PAID_V2_READ_ALIASES')
  async function optional(id: string, expected: string) {
    try { return await read(id, expected) } catch (error) { signal.throwIfAborted()
      if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
      throw error }
  }
  const key = { kind, buyer }, keyType = type(content.origins, 'paid_access', 'BuyerKey'), entryId = deriveDynamicFieldID(ledger.entries.id, keyType, PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const entryObject = buyer === view.ownerAddress ? null : await optional(entryId, `0x2::dynamic_field::Field<${keyType},${type(content.origins, 'paid_access', 'Entry')}>`)
  const entryField = entryObject ? decodeCommerce(EntryField, entryObject.contents) : null, entry = entryField?.value ?? null
  commerceCheck(!entryField || entryObject!.owner.ObjectOwner === ledger.entries.id && entryField.id === entryId && entryField.name.kind === kind
    && entryField.name.buyer === buyer && BigInt(entryField.value.revision) <= BigInt(ledger.revision) && BigInt(ledger.entries.size) > 0n, 'PUBLIC_PAID_V2_READ_ENTRY')
  async function recheck() {
    for (const row of observations) { const current = await readCommerceObject(client, row.id, row.type, signal)
      commerceCheck(current.version === row.version && current.digest === row.digest, 'PUBLIC_PAID_V2_READ_CHANGED') }
    const latest = await readNativePublicReadRecordV2({ client, target, soulId, recordIndex, signal })
    // Clock advances naturally; every content/custody/Host observation must match.
    commerceCheck(publicMutationCanonical({ ...latest, clockTimestampMs: null }) === publicMutationCanonical({ ...view, clockTimestampMs: null }), 'PUBLIC_PAID_V2_READ_HOST_RECORD_CHANGED')
  }
  async function now(minimum: string) {
    const row = await readCommerceObject(client, clockId, '0x2::clock::Clock', signal), value = decodeCommerce(Clock, row.contents)
    commerceCheck(row.owner.Shared?.initialSharedVersion === '1' && value.id === clockId && BigInt(value.timestamp_ms) >= BigInt(minimum), 'PUBLIC_PAID_V2_READ_CLOCK')
    return value.timestamp_ms
  }
  await recheck(); let observedAtMs = await now(view.clockTimestampMs)
  let offer: ReturnType<typeof PaidContentOfferBcs.parse> | null = null
  let offerReference: {objectId:string;version:string;digest:string} | null = null
  let decision = buyer === view.ownerAddress && (BigInt(view.record.read_mask) & 1n) === 0n
    ? { action: 'BLOCKED' as const, reason: 'OWNER_READ_DISABLED' as const }
    : paidContentDecision({ buyer, owner: view.ownerAddress, generation: BigInt(auth.generation), scope: requiredScope, nowMs: BigInt(observedAtMs), entry, offer })
  let income: Awaited<ReturnType<typeof readEconomicsIncome>> | null = null
  let configSharedReference: { objectId: string; initialSharedVersion: string } | null = null
  if (decision.action === 'BLOCKED' && decision.reason === 'NO_SALE_OFFER') {
    const offerId = deriveDynamicFieldID(ledger.offers.id, 'u32', bcs.u32().serialize(kind).toBytes()), object = await optional(offerId, `0x2::dynamic_field::Field<u32,${type(content.origins, 'paid_access', 'Offer')}>`)
    const field = object ? decodeCommerce(OfferField, object.contents) : null
    commerceCheck(!field || object!.owner.ObjectOwner === ledger.offers.id && field.id === offerId && field.name === kind
      && BigInt(field.value.revision) <= BigInt(ledger.revision) && BigInt(ledger.offers.size) > 0n, 'PUBLIC_PAID_V2_READ_OFFER')
    offer = field?.value ?? null
    offerReference = object ? {objectId:object.objectId,version:object.version,digest:object.digest} : null
    decision = paidContentDecision({ buyer, owner: view.ownerAddress, generation: BigInt(auth.generation), scope: requiredScope, nowMs: BigInt(observedAtMs), entry, offer })
    if (decision.action === 'PURCHASE_REQUIRED' && economics) {
      income = await readEconomicsIncome({ client, target: economics, signal })
      for (const from of [native, content]) { const dependency = from.linkage.get(economics.foundation.originalPackageId)
        commerceCheck(dependency?.upgradedId === economics.foundation.callablePackageId && dependency.upgradedVersion === income.foundationVersion, 'PUBLIC_PAID_V2_READ_FEE_LINK') }
    }
    await recheck()
    if (income) { const current = await readCommerceObject(client, income.object.objectId, income.configType, signal)
      commerceCheck(current.version === income.object.version && current.digest === income.object.digest, 'PUBLIC_PAID_V2_READ_CONFIG_CHANGED')
      const birth = current.owner.Shared?.initialSharedVersion
      commerceCheck(birth && BigInt(birth) > 0n && BigInt(birth) <= BigInt(current.version), 'PUBLIC_PAID_V2_READ_CONFIG_SHARED')
      configSharedReference = { objectId: current.objectId, initialSharedVersion: birth } }
    observedAtMs = await now(observedAtMs)
    decision = paidContentDecision({ buyer, owner: view.ownerAddress, generation: BigInt(auth.generation), scope: requiredScope, nowMs: BigInt(observedAtMs), entry, offer })
  }
  const quote = decision.action === 'PURCHASE_REQUIRED' && offer && income ? quoteNativePaidContent({ root: soulId, protocol: ledger.protocol, kind, offer,
    feeRevision: income.config.revision, primaryBps: income.config.primary_bps, platformRecipient: income.config.recipient }) : null
  const gates = decision.action === 'PURCHASE_REQUIRED' && income ? recoverEconomicsHistoricalGates(income.config).gates : null
  const role = income?.config.roles.roles[5], revisionOrigin = content.origins.get('paid_access::PaidRevision1')
  const roleValid = role?.pinned && role.original === content.pin.originalPackageId && role.callable === revisionOrigin
    && revisionOrigin && role.marker && normalizeStructTag(role.marker.name) === `${revisionOrigin}::paid_access::PaidRevision1`
    && content.origins.get('paid_access::PaidAuthority1') === content.pin.originalPackageId
  const purchaseBlockers = decision.action !== 'PURCHASE_REQUIRED' ? [] : !income ? ['FEE_RELEASE_NOT_CONFIGURED'] : [
    ...(!income.config.enabled ? ['PROTOCOL_DISABLED'] : []), ...(income.config.paused ? ['PROTOCOL_PAUSED'] : []),
    ...(!gates?.primary ? ['PRIMARY_MARKET_DISABLED'] : []), ...(!roleValid ? ['PAID_ROLE_UNVERIFIED'] : []),
    ...(BigInt(income.config.minimum_release) > 2n ? ['UNSUPPORTED_PROTOCOL_RELEASE'] : []),
  ]
  return { format: 'native-public-read-v2' as const, product: 'existing-soul-content-subscription' as const, buyer, soulId, hostId: view.hostId, stateId: view.stateId,
    ledgerId: ledger.id, kind, recordIndex, contentName: view.record.name, contentVersion: view.record.version, contentScope: view.record.scope, namespace: view.namespace,
    owner: view.ownerAddress, generation: auth.generation, offer, offerReference, ledgerRevision: ledger.revision, observedAtMs, decision, quote, gates, purchaseBlockers,
    entryHash: entry ? toHex(sha256(PaidContentEntryBcs.serialize(entry).toBytes())) : null, coinType: income?.coinType ?? null,
    authReference: { objectId: auth.id, version: authObject.version, digest: authObject.digest }, ledgerReference: { objectId: ledger.id, version: ledgerObject.version, digest: ledgerObject.digest },
    shared: view.shared, configSharedReference, feeRevision: income?.config.revision ?? null, platformRecipient: income?.config.recipient ?? null, configReference: income?.object ?? null, recordReference: view.recordReference, hostReference: view.hostReference,
    requiresQualifiedSourceAndFormatAdoption: true as const, requiresCurrentSourceAndFeeQualification: true as const, requiresQualifiedHostParentCommitInvariant: true as const, notAuthorization: true as const,
    remainingPurchasePreflight: ['CURRENT_SOURCE_AND_FEE_QUALIFICATION', 'EXACT_V2_ABI_AND_QUOTE', 'FULL_PACKET_FUNDING_SIMULATION', 'ACTUAL_PROTECTED_DELIVERY'] as const }
}


export function nativePublicReadPaidReviewIdentityV2(value: Awaited<ReturnType<typeof readNativePublicReadPaidV2>>) {
  const { observedAtMs: _, ...review } = value
  const decision = review.decision.action === 'PURCHASE_REQUIRED' ? { action: review.decision.action } : review.decision
  return publicMutationCanonical({ ...review, decision })
}
