import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, toBase58 } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, profileReadStep, quoteAnimacraftV8SoulSale, SoulPublicKioskBcs,
  SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, tryExtractAnimacraftV8SoulPurchasedEvent } from '@soulidity/sdk'
import { queryMarketBuyOperationEvidence } from './market-buy-operation-adapter'
import { queryMarketListOperationEvidence } from './market-list-operation-adapter'
import {queryMarketBatchListOperationEvidence} from './market-batch-list-operation-adapter'
import {validateMarketBatchListOperationRecord,type BatchMarketListOperationRecord} from './market-batch-list-operation'
import { queryMarketCancelOperationEvidence } from './market-cancel-operation-adapter'
import { validateMarketBuyOperationRecord, type MarketBuyOperationRecord } from './market-buy-operation'
import { validateMarketListOperationRecord, type MarketListOperationRecord } from './market-list-operation'
import { validateMarketCancelOperationRecord, type MarketCancelOperationRecord } from './market-cancel-operation'
import { attestNativeReceiveTarget, createNativeReceiveClient, decodeNativeBcs, NativeReceiveError,
  NativeSoulBcs, NativeSoulBindingBcs, NativeSoulStateBcs, receiveId, type NativeReceiveTarget } from './native-receive'
import { EquipmentPointerBcs, EquipmentReadSet } from './native-equipment'
import { NativeMarketListingBcs } from './native-market'
import { verifyNativeMarketListing } from './native-market-listing'
import { verifyNativeMarketCancellation } from './native-market-cancellation'
import { verifyNativePurchaseWithClient } from './native-purchase-verifier'

type Record = MarketBuyOperationRecord | MarketListOperationRecord | MarketCancelOperationRecord
type Options = { target: NativeReceiveTarget; signal?: AbortSignal }
type Dependencies = { client?: SuiGrpcClient }
type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Raw = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
const paths = ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'package', 'previous_transaction']
const fingerprint = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item)
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_MARKET_READBACK_PENDING', message, 503)
}

/** A detached, bounded read session. Re-reads compare raw bytes as well as
 * references, including immutable packages and exact optional-field absence. */
function readSession(original: SuiGrpcClient, signal: AbortSignal, selectedRows=1) {
  const seen = new Map<string, { request: { objectId: string; version?: bigint }; value: string }>()
  const batches = new Map<string, { request: unknown; value: string }>()
  let calls = 0, bytes = 0
  const accept = (request: { objectId?: string; version?: bigint }, row: Raw | undefined) => {
    check(row && row.objectId === request.objectId && typeof row.version === 'bigint' && row.version > 0n
      && row.version <= 18446744073709551615n && (request.version === undefined || row.version === request.version), 'Object reference unavailable or mismatched')
    check(typeof row.digest === 'string' && fromBase58(row.digest).length === 32
      && toBase58(fromBase58(row.digest)) === row.digest, 'Invalid object digest')
    if (row.owner?.kind === 3) check(typeof row.owner.version === 'bigint' && row.owner.version > 0n
      && row.owner.version <= row.version, 'Invalid shared object birth version')
    const size = row.contents?.value?.length ?? 0
    check(size <= 256 * 1024 && (bytes += size) <= Math.min(64,16*selectedRows) * 1024 * 1024, 'Readback object budget exceeded')
    const key = `${request.objectId}:${request.version ?? 'current'}`, value = fingerprint(row)
    check(!seen.has(key) || seen.get(key)!.value === value, 'Object changed during readback')
    seen.set(key, { request: { objectId: row.objectId!, ...(request.version === undefined ? {} : { version: request.version }) }, value })
  }
  const ledger = new Proxy(original.ledgerService, { get(value, key) {
    const method = Reflect.get(value, key, value)
    if (typeof method !== 'function') return method
    return (input: any, options?: any) => {
      signal.throwIfAborted(); check(++calls <= 256*selectedRows, 'Readback call budget exceeded')
      const request = structuredClone(input)
      if (key === 'getObject' || key === 'batchGetObjects') request.readMask = { paths }
      const call = method.call(value, request, { ...options, abort: signal })
      const finished = profileReadStep(signal, async () => {
        const wire = await call, result = { ...wire, response: structuredClone(wire.response) }
        if (key === 'getObject') accept(request, result.response.object)
        if (key === 'batchGetObjects') {
          check(result.response.objects.length === request.requests.length, 'Incomplete batch evidence')
          result.response.objects.forEach((entry: any, index: number) => {
            if (entry.result.oneofKind === 'object') accept(request.requests[index], entry.result.object)
            else check(entry.result.oneofKind === 'error' && entry.result.error.code === 5, 'Optional evidence unavailable')
          })
          const key = fingerprint(request), value = fingerprint(result.response)
          check(!batches.has(key) || batches.get(key)!.value === value, 'Optional evidence changed during readback')
          batches.set(key, { request, value })
        }
        return result
      })
      return new Proxy(call, { get(value, key) {
        if (key === 'then') return finished.then.bind(finished)
        if (key === 'response') return finished.then(result => result.response)
        return Reflect.get(value, key, value)
      } })
    }
  } })
  const coreResults = new Map<string, string>()
  const core = new Proxy(original.core, { get(value, key) {
    const method = Reflect.get(value, key, value)
    if (key !== 'getChainIdentifier' && key !== 'getDynamicField') return typeof method === 'function' ? method.bind(value) : method
    return (...args: unknown[]) => profileReadStep(signal, async () => {
      const result = structuredClone(await method.apply(value, args)), id = `${String(key)}:${fingerprint(args)}`
      check(!coreResults.has(id) || coreResults.get(id) === fingerprint(result), 'Protocol evidence changed')
      coreResults.set(id, fingerprint(result)); return result
    })
  } })
  const client = new Proxy(original, { get(value, key) {
    return key === 'ledgerService' ? ledger : key === 'core' ? core : Reflect.get(value, key, value)
  } })
  return { client, async verify() {
    for (const { request } of [...seen.values()]) await client.ledgerService.getObject({ ...request, readMask: { paths } })
    for (const { request } of batches.values()) await client.ledgerService.batchGetObjects(request as Parameters<typeof client.ledgerService.batchGetObjects>[0])
    signal.throwIfAborted()
  } }
}

function outputReference(effects: Effects, objectId: string) {
  if (effects.V2) {
    const rows = effects.V2.changedObjects.filter(([id]) => id === objectId)
    check(rows.length === 1 && rows[0][1].outputState.ObjectWrite, 'Transaction object output missing')
    const [digest, owner] = rows[0][1].outputState.ObjectWrite
    check(owner.Shared, 'Transaction output must remain shared')
    const change = rows[0][1], version = BigInt(effects.V2.lamportVersion), birth = BigInt(owner.Shared.initialSharedVersion)
    const created = change.idOperation.$kind === 'Created'
    check(version > 0n && birth > 0n && birth <= version, 'Invalid shared output version')
    if (created) check(change.inputState.$kind === 'NotExist' && birth === version, 'Invalid newly created shared output')
    else check(change.idOperation.$kind === 'None' && change.inputState.Exist
      && BigInt(change.inputState.Exist[0][0]) < version && BigInt(change.inputState.Exist[0][0]) >= birth
      && change.inputState.Exist[1].Shared?.initialSharedVersion === owner.Shared.initialSharedVersion,
    'Invalid existing shared object write')
    return { version, digest, birth, created }
  }
  check(effects.V1, 'Unsupported transaction effects')
  const rows = [...effects.V1.created, ...effects.V1.mutated].filter(([ref]) => ref.objectId === objectId)
  check(rows.length === 1 && rows[0][1].Shared, 'Transaction object output missing')
  const version = BigInt(rows[0][0].version), birth = BigInt(rows[0][1].Shared.initialSharedVersion)
  const created = effects.V1.created.some(([ref]) => ref.objectId === objectId)
  check(version > 0n && birth > 0n && (created ? birth === version : birth < version), 'Invalid V1 shared output version')
  return { version, digest: rows[0][0].digest, birth, created }
}

// Shared evidence plumbing for equipment receipts; these helpers neither infer
// a transaction's business outcome nor weaken its concrete graph validator.
export {readSession as createNativeMarketReadbackSession,outputReference as nativeMarketSharedOutputReference}

async function confirm(value: Record, options: Options, dependencies: Dependencies): Promise<'COMPLETE' | 'SUPERSEDED'> {
  const record = value.kind === 'buy' ? validateMarketBuyOperationRecord(value)
    : value.kind === 'cancel-listing' ? validateMarketCancelOperationRecord(value) : validateMarketListOperationRecord(value)
  const target = structuredClone(options.target)
  check(record.phase === 'SUCCEEDED', 'Only finalized successful operations can be confirmed')
  const s = record.kind === 'cancel-listing' ? record : record.snapshot
  check(s.release.protocolConfigId === target.protocolConfigId
    && s.release.soulidityCallablePackageId === target.soulidityCallablePackageId
    && s.release.soulidityCallableDigest === target.soulidityCallableDigest
    && (!('soulidityOriginalPackageId' in s.release) || s.release.soulidityOriginalPackageId === target.soulidityOriginalPackageId), 'Captured release mismatch')
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const session = readSession(dependencies.client ?? createNativeReceiveClient(signal), signal), client = session.client
  const proof = record.kind === 'buy' ? await queryMarketBuyOperationEvidence(record, client)
    : record.kind === 'cancel-listing' ? await queryMarketCancelOperationEvidence(record, client)
      : await queryMarketListOperationEvidence(record, client)
  check(proof.status === 'SUCCEEDED' && proof.originalPackageId === target.soulidityOriginalPackageId, 'Finalized transaction proof unavailable')
  const result=await confirmVerified(record,target,signal,session,proof)
  await session.verify()
  return result
}

type VerifiedMarketProof=Extract<Awaited<ReturnType<typeof queryMarketBuyOperationEvidence>>|
  Awaited<ReturnType<typeof queryMarketListOperationEvidence>>|
  Awaited<ReturnType<typeof queryMarketCancelOperationEvidence>>,{status:'SUCCEEDED'}>
/** Authenticated row proof evaluator. Its caller validates either the entire single
 * packet or the entire batch packet before providing this selected row view. */
async function confirmVerified(record:Record,target:NativeReceiveTarget,signal:AbortSignal,
  session:ReturnType<typeof readSession>,proof:VerifiedMarketProof):Promise<'COMPLETE'|'SUPERSEDED'>{
  const client=session.client
  const s=record.kind==='cancel-listing'?record:record.snapshot
  const types = await attestNativeReceiveTarget(client, target, { market: true }), reads = new EquipmentReadSet(client)
  const ref = outputReference(proof.effects, s.stateId)
  const sharedInput = Transaction.from(fromBase64(record.bytes)).getData().inputs
    .flatMap(input => input.Object?.SharedObject ? [input.Object.SharedObject] : []).find(input => input.objectId === s.stateId)
  check(sharedInput && BigInt(sharedInput.initialSharedVersion) === ref.birth && !ref.created, 'SoulState output birth mismatch')
  const historicalRaw = (await client.ledgerService.getObject({ objectId: s.stateId, version: ref.version })).response.object!
  check(historicalRaw.digest === ref.digest && historicalRaw.owner?.version === ref.birth, 'Historical SoulState differs from finalized effects')
  const historyReads = new EquipmentReadSet(client)
  const post = decodeNativeBcs(NativeSoulStateBcs, historyReads.accept(historicalRaw, s.stateId, types.stateType, 3))
  const buyer = record.kind === 'buy' ? record.snapshot.buyer : null
  const owner = record.kind === 'buy' ? record.snapshot.buyer : record.kind === 'cancel-listing' ? record.owner : record.snapshot.owner
  const kiosk = record.kind === 'buy' ? record.snapshot.buyerKioskId : record.kind === 'cancel-listing' ? record.kioskId : record.snapshot.kioskId
  const epoch = BigInt(s.ownershipEpoch) + (buyer ? 1n : 0n), listed = record.kind === 'list' || record.kind === 'reprice'
  check(post.id === s.stateId && post.version === '1' && post.soul_id === s.soulId && post.current_owner === owner
    && (!kiosk || post.current_kiosk_id === kiosk) && BigInt(post.ownership_epoch) === epoch
    && post.is_listed === listed && post.collection_id === null, 'Historical SoulState postcondition mismatch')
  if (buyer && !kiosk) check(outputReference(proof.effects, post.current_kiosk_id).created, 'New buyer Kiosk output missing')
  if (buyer) {
    // Purchase removes the seller's Item field and creates the buyer's field.
    // Prove that custody at the receipt version even if the asset later moves.
    const itemFieldId = deriveKioskItemFieldId(post.current_kiosk_id, s.soulId)
    check(record.kind === 'buy', 'Purchase record required')
    const sellerKioskId = record.snapshot.sellerKioskId
    const sellerFieldId = deriveKioskItemFieldId(sellerKioskId, s.soulId)
    check(post.current_kiosk_id !== sellerKioskId && new Set([itemFieldId, sellerFieldId, s.soulId, sellerKioskId,
      post.current_kiosk_id]).size === 5, 'Purchase Kiosk custody aliases')
    const historicalItem = async (id: string, type: string, parent: string, created: boolean) => {
      let version: bigint, digest: string
      if (proof.effects.V2) {
        const changes = proof.effects.V2.changedObjects.filter(([key]) => key === id)
        check(changes.length === 1, 'Historical Kiosk Item output missing')
        const change = changes[0][1], output = change.outputState.ObjectWrite
        check(output?.[1].ObjectOwner === parent && change.idOperation.$kind === (created ? 'Created' : 'None')
          && (created ? change.inputState.$kind === 'NotExist' : Boolean(change.inputState.Exist)), 'Historical Kiosk Item effects custody mismatch')
        version = BigInt(proof.effects.V2.lamportVersion); digest = output[0]
        if (!created) check(change.inputState.Exist![1].ObjectOwner === sellerFieldId
          && BigInt(change.inputState.Exist![0][0]) > 0n && BigInt(change.inputState.Exist![0][0]) < version,
        'Historical Soul input custody/version mismatch')
      } else {
        check(proof.effects.V1, 'Unsupported transaction effects')
        const changes = (created ? proof.effects.V1.created : proof.effects.V1.mutated).filter(([ref]) => ref.objectId === id)
        check(changes.length === 1 && changes[0][1].ObjectOwner === parent, 'Historical Kiosk Item effects custody mismatch')
        version = BigInt(changes[0][0].version); digest = changes[0][0].digest
      }
      const raw = (await client.ledgerService.getObject({ objectId: id, version })).response.object!
      check(raw.digest === digest && raw.previousTransaction === record.digest, 'Historical Kiosk Item reference/transaction mismatch')
      return historyReads.accept(raw, id, type, 2, parent)
    }
    const itemBytes = await historicalItem(itemFieldId, KIOSK_ITEM_FIELD_TYPE, post.current_kiosk_id, true)
    check(itemBytes instanceof Uint8Array, 'Historical Kiosk Item BCS missing')
    assertKioskItemField(itemBytes, post.current_kiosk_id, s.soulId)
    const acquired = decodeNativeBcs(NativeSoulBcs, await historicalItem(s.soulId, types.soulType, itemFieldId, false))
    check(acquired.id === s.soulId && acquired.version === '1' && acquired.provenance_kind === 3
      && acquired.creator === post.creator, 'Historical purchased Soul identity mismatch')
    let sellerVersion: bigint, sellerDigest: string | undefined
    if (proof.effects.V2) {
      const rows = proof.effects.V2.changedObjects.filter(([id]) => id === sellerFieldId)
      check(rows.length === 1, 'Seller Kiosk Item deletion missing')
      const change = rows[0][1], before = change.inputState.Exist
      check(change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist'
        && before?.[1].ObjectOwner === sellerKioskId, 'Seller Kiosk Item deletion custody mismatch')
      sellerVersion = BigInt(before[0][0]); sellerDigest = before[0][1]
    } else {
      const effects = proof.effects.V1!
      const deleted = effects.deleted.filter(row => row.objectId === sellerFieldId)
      const versions = effects.modifiedAtVersions.filter(([id]) => id === sellerFieldId)
      check(deleted.length === 1 && deleted[0].version === String(ref.version)
        && fromBase58(deleted[0].digest).every(byte => byte === 99) && versions.length === 1,
      'Seller Kiosk Item V1 deletion missing')
      // V1 only commits the predecessor version, not its input digest.
      sellerVersion = BigInt(versions[0][1])
      const soulVersions = effects.modifiedAtVersions.filter(([id]) => id === s.soulId)
      check(soulVersions.length === 1 && BigInt(soulVersions[0][1]) > 0n
        && BigInt(soulVersions[0][1]) < ref.version, 'Historical V1 Soul input version mismatch')
      const priorRaw = (await client.ledgerService.getObject({ objectId: s.soulId, version: BigInt(soulVersions[0][1]) })).response.object!
      // A separate historical version of the same object is not current-read drift.
      const priorReads = new EquipmentReadSet(client)
      const priorSoul = decodeNativeBcs(NativeSoulBcs, priorReads.accept(priorRaw, s.soulId, types.soulType, 2, sellerFieldId))
      check(priorSoul.id === s.soulId && priorSoul.version === '1' && priorSoul.provenance_kind === 3
        && priorSoul.creator === acquired.creator, 'Historical V1 Soul input identity mismatch')
    }
    check(sellerVersion > 0n && sellerVersion < ref.version, 'Seller Kiosk Item input version mismatch')
    const sellerRaw = (await client.ledgerService.getObject({ objectId: sellerFieldId, version: sellerVersion })).response.object!
    check(sellerDigest === undefined || sellerRaw.digest === sellerDigest, 'Seller Kiosk Item input digest mismatch')
    const sellerBytes = historyReads.accept(sellerRaw, sellerFieldId, KIOSK_ITEM_FIELD_TYPE, 2, sellerKioskId)
    check(sellerBytes instanceof Uint8Array, 'Seller Kiosk Item BCS missing')
    assertKioskItemField(sellerBytes, sellerKioskId, s.soulId)
  }
  const currentRaw = (await client.ledgerService.getObject({ objectId: s.stateId })).response.object!
  check(currentRaw.version! >= ref.version && currentRaw.owner?.version === ref.birth
    && (currentRaw.version !== ref.version || fingerprint(currentRaw) === fingerprint(historicalRaw)), 'Current SoulState predates transaction')
  const state = decodeNativeBcs(NativeSoulStateBcs, reads.accept(currentRaw, s.stateId, types.stateType, 3))
  check(state.id === s.stateId && state.version === '1' && state.soul_id === s.soulId && state.creator === post.creator
    && state.creator_royalty_bps === post.creator_royalty_bps && BigInt(state.ownership_epoch) >= epoch, 'Current SoulState identity/epoch mismatch')
  receiveId(state.current_owner); receiveId(state.current_kiosk_id)
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(s.soulId, types.soulType, state.current_kiosk_id))
  check(soul.id === s.soulId && soul.version === '1' && soul.creator === state.creator && soul.provenance_kind === 3, 'Native Soul custody mismatch')
  const currentKiosk = decodeNativeBcs(SoulPublicKioskBcs, await reads.read(state.current_kiosk_id, '0x2::kiosk::Kiosk', 3))
  check(currentKiosk.id === state.current_kiosk_id && currentKiosk.owner === state.current_owner && currentKiosk.item_count > 0, 'Current Kiosk custody mismatch')
  const fieldId = deriveDynamicFieldID(s.stateId, 'u8', new Uint8Array([9]))
  const field = decodeNativeBcs(EquipmentPointerBcs, await reads.read(fieldId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, s.stateId))
  check(field.id === fieldId && field.name === 9 && field.value === s.bindingId, 'Saved native DF9 binding changed')
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(s.bindingId, types.bindingType, 4))
  check(binding.id === s.bindingId && binding.version === '8' && binding.soul_id === s.soulId && binding.soul_state_id === s.stateId
    && binding.protocol_config_id === target.protocolConfigId && binding.original_holder === state.creator
    && binding.rights.soul_creator_royalty_bps === state.creator_royalty_bps, 'Immutable native identity mismatch')
  receiveId(binding.maker_creator)
  quoteAnimacraftV8SoulSale(1n, { soulCreatorRoyaltyBps: state.creator_royalty_bps, makerSourceRoyaltyBps: binding.rights.maker_source_royalty_bps })
  if (record.kind !== 'cancel-listing') check(state.creator === record.snapshot.creator && binding.maker_creator === record.snapshot.makerCreator
    && state.creator_royalty_bps === record.snapshot.soulCreatorRoyaltyBps
    && binding.rights.maker_source_royalty_bps === record.snapshot.makerSourceRoyaltyBps, 'Saved native royalty identity mismatch')
  if (state.is_listed) check(await reads.pointer(s.stateId) === null, 'Listed Soul has equipment custody')
  const rotated = state.current_owner !== post.current_owner || state.current_kiosk_id !== post.current_kiosk_id
  check(!rotated || BigInt(state.ownership_epoch) > epoch, 'Custody changed without ownership epoch advance')
  // A creator can bind a held native Soul into a Collection after cancellation
  // or purchase. Prove that later membership, not a generic verifier error.
  if (state.collection_id !== null) {
    check(!state.is_listed, 'Native solo listing cannot belong to a Collection')
    check(state.ownership_epoch !== post.ownership_epoch || state.current_owner === state.creator,
      'Collection was bound without creator custody')
    const pkg = (await client.ledgerService.getObject({ objectId: target.soulidityCallablePackageId })).response.object!.package!
    for (const name of ['SoulCollection', 'SoulCollectionRight']) check(pkg.typeOrigins.filter(origin =>
      origin.moduleName === 'collection' && origin.datatypeName === name && origin.packageId === target.soulidityOriginalPackageId).length === 1,
    'Collection type origin mismatch')
    const collection = decodeNativeBcs(SoulPublicCollectionBcs, await reads.read(receiveId(state.collection_id),
      `${target.soulidityOriginalPackageId}::collection::SoulCollection`, 3))
    check(collection.id === state.collection_id && collection.version === '1' && collection.creator === state.creator
      && collection.extra_royalty_bps <= 10000 && BigInt(collection.current_supply) > 0n
      && (collection.max_supply === null || BigInt(collection.max_supply) > 0n
        && BigInt(collection.current_supply) <= BigInt(collection.max_supply)), 'Current Collection membership mismatch')
    const right = decodeNativeBcs(SoulPublicCollectionRightBcs, await reads.kioskItem(receiveId(collection.right_id),
      `${target.soulidityOriginalPackageId}::collection::SoulCollectionRight`, receiveId(collection.current_holder_kiosk_id)))
    check(right.id === collection.right_id && right.version === '1' && right.collection_id === collection.id
      && right.creator === collection.creator, 'Collection Right custody mismatch')
    const holderKiosk = decodeNativeBcs(SoulPublicKioskBcs, await reads.read(collection.current_holder_kiosk_id, '0x2::kiosk::Kiosk', 3))
    check(holderKiosk.id === collection.current_holder_kiosk_id && holderKiosk.owner === receiveId(collection.current_holder)
      && holderKiosk.item_count > 0, 'Collection holder Kiosk mismatch')
  }
  let superseded = rotated || state.ownership_epoch !== post.ownership_epoch || state.is_listed !== post.is_listed
    || state.collection_id !== post.collection_id
  if (superseded) check(currentRaw.version! > ref.version, 'Later custody requires a later State version')
  if (listed) {
    check('listing_id' in proof.receipt && 'price' in proof.receipt, 'Listing receipt missing')
    const listingId = proof.receipt.listing_id, listingRef = outputReference(proof.effects, listingId)
    check(listingRef.created, 'New listing was not created by this transaction')
    const oldRaw = (await client.ledgerService.getObject({ objectId: listingId, version: listingRef.version })).response.object!
    check(oldRaw.digest === listingRef.digest && oldRaw.owner?.version === listingRef.birth, 'Historical listing effects mismatch')
    const old = decodeNativeBcs(NativeMarketListingBcs, historyReads.accept(oldRaw, listingId, types.marketTypes!.listing, 3))
    check(old.id === listingId && old.version === '8' && old.soul_id === s.soulId && old.state_id === s.stateId
      && old.seller === owner && old.seller_kiosk_id === post.current_kiosk_id && old.creator === state.creator
      && old.creator_royalty_bps === state.creator_royalty_bps && old.collection_id === null && old.is_active
      && old.price === proof.receipt.price && old.purchase_cap?.item_id === s.soulId
      && old.purchase_cap.kiosk_id === post.current_kiosk_id && old.purchase_cap.min_price === '0', 'Historical listing receipt mismatch')
    receiveId(old.purchase_cap.id)
    if (!superseded) {
    const liveRaw = (await client.ledgerService.getObject({ objectId: listingId })).response.object!
    check(liveRaw.version! >= listingRef.version && liveRaw.owner?.version === listingRef.birth, 'Listing reference regressed')
    check(liveRaw.version !== listingRef.version || fingerprint(liveRaw) === fingerprint(oldRaw), 'Listing same-version evidence mismatch')
    const live = decodeNativeBcs(NativeMarketListingBcs, reads.accept(liveRaw, listingId, types.marketTypes!.listing, 3))
    check(fingerprint({ ...live, is_active: true, purchase_cap: old.purchase_cap }) === fingerprint(old), 'Listing immutable fields changed')
    if (!live.is_active && live.purchase_cap === null) {
      check(liveRaw.version! > listingRef.version && currentRaw.version! > ref.version, 'Inactive listing lacks later state evidence')
      superseded = true
    }
    }
  }
  if (!superseded) {
    const eventName = buyer ? 'AnimacraftV8SoulPurchased' : listed ? 'SoulListed' : 'SoulListingCancelled'
    const transaction = { digest: record.digest, events: [{ type: `${proof.originalPackageId}::market::${eventName}`, parsedJson: proof.receipt }] }
    if (buyer) {
      const purchase = tryExtractAnimacraftV8SoulPurchasedEvent(transaction, proof.originalPackageId)
      check(purchase, 'Verified native purchase receipt unavailable')
      await verifyNativePurchaseWithClient(client, target, s.soulId, s.stateId, purchase, signal)
    } else if (listed) await verifyNativeMarketListing(client, target,
      { soulId: s.soulId, stateId: s.stateId, txDigest: record.digest, sender: owner, transaction }, signal)
    else await verifyNativeMarketCancellation(client, target,
      { soulId: s.soulId, stateId: s.stateId, txDigest: record.digest, sender: owner, transaction }, signal)
  }
  await attestNativeReceiveTarget(client, target, { market: true })
  return superseded ? 'SUPERSEDED' : 'COMPLETE'
}

export const confirmBrowserNativeMarketBuy = (record: MarketBuyOperationRecord, options: Options, dependencies: Dependencies = {}) => confirm(record, options, dependencies)
export const confirmBrowserNativeMarketList = (record: MarketListOperationRecord, options: Options, dependencies: Dependencies = {}) => confirm(record, options, dependencies)
export const confirmBrowserNativeMarketCancel = (record: MarketCancelOperationRecord, options: Options, dependencies: Dependencies = {}) => confirm(record, options, dependencies)
export {confirmVerified as confirmAuthenticatedNativeMarketRow}

/** Certify every selected Soul's historical output and current custody under
 * one bounded read session. A missing row is PENDING, never partial success. */
export async function confirmBrowserNativeMarketBatchList(value:BatchMarketListOperationRecord,options:Options,dependencies:Dependencies={}):Promise<'COMPLETE'|'SUPERSEDED'>{
  const record=validateMarketBatchListOperationRecord(value),target=structuredClone(options.target)
  check(record.phase==='SUCCEEDED','Only a finalized successful batch can be confirmed')
  const release=record.rows[0].snapshot.release
  check(release.protocolConfigId===target.protocolConfigId&&release.soulidityCallablePackageId===target.soulidityCallablePackageId
    &&release.soulidityCallableDigest===target.soulidityCallableDigest&&release.soulidityOriginalPackageId===target.soulidityOriginalPackageId,'Captured batch release mismatch')
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const session=readSession(dependencies.client??createNativeReceiveClient(signal),signal,record.rows.length)
  const proof=await queryMarketBatchListOperationEvidence(record,session.client)
  check(proof.status==='SUCCEEDED'&&proof.originalPackageId===target.soulidityOriginalPackageId,'Finalized batch proof unavailable')
  let superseded=false
  for(const [index,row] of record.rows.entries()){
    check(row.assetType==='soul'&&record.equipment===undefined,'Grouped records require complete mixed readback')
    const view:MarketListOperationRecord={...record,kind:'list',snapshot:row.snapshot,priceAtomic:row.priceAtomic}
    const outcome=await confirmVerified(view,target,signal,session,{...proof,receipt:proof.receipts[index]})
    superseded ||= outcome==='SUPERSEDED'
  }
  await session.verify()
  return superseded?'SUPERSEDED':'COMPLETE'
}
