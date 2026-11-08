import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { vi } from 'vitest'
import { CanonicalOwnedAccountBcs, CanonicalSoulBcs } from '../../../web/lib/soulidity/canonical-native-workbench'
import { NativeOfferBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { SaleCollectionBcs, SaleCollectionMemberBcs } from '../../../web/lib/soulidity/commerce/collection-sale-proof'
import { NativeTransferPolicyBcs, NativeMarketRuleFieldBcs } from '../../../web/lib/soulidity/commerce/native-sale-conditions'
import { buildNativeSaleGraph } from '../../../web/lib/soulidity/commerce/native-sale-graph'
import { NativeSaleRegistryBcs, NativeSaleSourceLocationBcs } from '../../../web/lib/soulidity/commerce/native-sale-source-binding'
import { nativeSaleSoulManifest } from '../../../web/lib/soulidity/commerce/native-sale-tree'
import { moveEmptyStructBytes } from '../../../web/lib/sui/move-empty-struct'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import { nativeSaleRelistFixture } from './commerce-native-sale-lifecycle'
import { purchaseRecoveryCleanupFixture } from './commerce-purchase-recovery-cleanup'
import { nativeSaleCancellationFixture } from './commerce-sale-cancellation'

type RawObject = ReturnType<typeof bcs.Object.parse>
type Move = NonNullable<RawObject['data']['Move']>
type FixtureRow = { objectId: string; objectType: string; version: bigint; digest: string; previousTransaction: string;
  bcs: { value: Uint8Array }; contents: { value: Uint8Array }; owner: { kind: number; version?: bigint; address?: string } }

export function objectRow(objectId: string, type: string, raw: Parameters<typeof bcs.Object.serialize>[0]): FixtureRow {
  const bytes = bcs.Object.serialize(raw).toBytes(), object = bcs.Object.parse(bytes), owner = object.owner
  const move = object.data.Move!
  return { objectId, objectType: normalizeStructTag(type), version: BigInt(move.version), digest: activityHash('Object', bytes),
    previousTransaction: object.previousTransaction, bcs: { value: bytes }, contents: { value: move.contents },
    owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
      : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 1, address: owner.AddressOwner } }
}

function rewrite(row: FixtureRow, writer: string, patch: Partial<Move> = {}, owner?: Parameters<typeof bcs.Owner.serialize>[0]) {
  const raw = bcs.Object.parse(row.bcs.value)
  return objectRow(row.objectId, row.objectType, { ...raw, data: { Move: { ...raw.data.Move!, ...patch } },
    previousTransaction: writer, owner: owner ?? raw.owner })
}

function owner(row: FixtureRow) { return bcs.Object.parse(row.bcs.value).owner }

export async function nativeSaleLifecycleWireFixture(variant = '', withCollection = false, buyerAddress?: string) {
  const sale = await purchaseRecoveryCleanupFixture(withCollection ? 'collection' : '', buyerAddress), { original, finality: purchase } = sale
  const { plan, context } = original, { target, economics } = context
  const ledger = sale.client.ledgerService
  const read = async (objectId: string, version?: bigint): Promise<FixtureRow> =>
    (await ledger.getObject({ objectId, version })).response.object

  const native = purchase.packageData.data.Package!
  native.moduleMap.set('registry', new Uint8Array([1]))
  native.typeOriginTable.push(...[
    ['market','Cancelled'], ['market','Rule'], ['market','RuleConfig'], ['registry','Registry'], ['registry','SoulProducer'],
  ].map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: target.native.originalPackageId })))
  if (withCollection) {
    native.typeOriginTable.push({ moduleName: 'birth', datatypeName: 'CollectionKey', package: target.native.originalPackageId })
  }
  purchase.rehashPackage()
  target.native = { ...target.native, callableDigest: purchase.pkg.digest }
  const foundation = await read(economics.foundation.callablePackageId)
  const rawFoundation = bcs.Object.parse(foundation.bcs.value)
  rawFoundation.data.Package!.typeOriginTable.push(...['SourceRegistryKey','SourceRegistryLocation'].map(datatypeName =>
    ({ moduleName: 'economics', datatypeName, package: economics.foundation.originalPackageId })))
  const foundationBytes = bcs.Object.serialize(rawFoundation).toBytes()
  const pinnedFoundation = { ...foundation, bcs: { value: foundationBytes }, digest: activityHash('Object', foundationBytes) }
  economics.foundation = { ...economics.foundation, callableDigest: pinnedFoundation.digest }

  const previousOffer = await read(plan.offerId, 9n), terms = NativeOfferBcs.parse(previousOffer.contents.value)
  const soulInput = await read(plan.soulId, 9n), soulOutput = await read(plan.soulId, 10n)
  function bindOrigin(row: FixtureRow) {
    const soul = CanonicalSoulBcs.parse(row.contents.value), origin = target.native.originalPackageId
    soul.origin.source = plan.registryId
    soul.origin.producer.name = `${origin}::registry::SoulProducer`
    soul.origin.source_type.name = `${origin}::registry::Registry`
    soul.origin.minted_by = terms.creator
    return CanonicalSoulBcs.serialize(soul).toBytes()
  }
  const soulBefore = rewrite(soulInput, soulInput.previousTransaction, { contents: bindOrigin(soulInput) })
  terms.manifest = nativeSaleSoulManifest(soulBefore.contents.value)

  // Source setup wrote the Config, registry directory and transfer rule before
  // the first seller action. Its canonical bytes and checkpoint are independent.
  const setup = await activityEvidenceFixture({ empty: true })
  setup.summaryData.sequence_number = '70'
  setup.rehashTransaction()
  const setupDigest = setup.ledger.digest, registryType = `${target.native.originalPackageId}::registry::Registry`
  const configInput = await read(plan.configId, 9n)
  const shared = { Shared: { initialSharedVersion: '7' } }
  const config = rewrite(configInput, setupDigest, { version: '7' }, shared)
  function setupObject(id: string, type: string, bytes: Uint8Array, ownership: Parameters<typeof bcs.Owner.serialize>[0]) {
    return objectRow(id, type, { data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
      hasPublicTransfer: true, version: 7, contents: bytes } }, owner: ownership, previousTransaction: setupDigest, storageRebate: 0 })
  }
  const registry = setupObject(plan.registryId, registryType, NativeSaleRegistryBcs.serialize({
    id: plan.registryId, protocol: plan.configId, schema: 1, kiosks: { id: aid(207), size: 2 },
  }).toBytes(), shared)
  const foundationOrigin = economics.foundation.originalPackageId
  const directoryKey = `${foundationOrigin}::economics::SourceRegistryKey<${registryType}>`
  const directoryId = deriveDynamicFieldID(plan.configId, directoryKey, moveEmptyStructBytes())
  const directory = setupObject(directoryId, `0x2::dynamic_field::Field<${directoryKey},${foundationOrigin}::economics::SourceRegistryLocation>`,
    NativeSaleSourceLocationBcs.serialize({ id: directoryId, name: { dummy_field: false }, value: { id: plan.registryId } }).toBytes(),
    { ObjectOwner: plan.configId })
  const ruleType = `${target.native.originalPackageId}::market::Rule`, ruleKey = `0x2::transfer_policy::RuleKey<${ruleType}>`
  const policy = setupObject(plan.policyId, `0x2::transfer_policy::TransferPolicy<${target.standard.originalPackageId}::soul::Soul>`,
    NativeTransferPolicyBcs.serialize({ id: plan.policyId, balance: 0, rules: { contents: [{ name: ruleType }] } }).toBytes(), shared)
  const ruleId = deriveDynamicFieldID(plan.policyId, ruleKey, moveEmptyStructBytes())
  const rule = setupObject(ruleId, `0x2::dynamic_field::Field<${ruleKey},${target.native.originalPackageId}::market::RuleConfig>`,
    NativeMarketRuleFieldBcs.serialize({ id: ruleId, name: { dummy_field: false },
      value: { config: plan.configId, currency: { name: plan.coinType } } }).toBytes(), { ObjectOwner: plan.policyId })
  const setupRows = [config, registry, directory, policy, rule]
  let collectionRow: FixtureRow | null = null, stateInput: FixtureRow | null = null
  let collectionHolder: string | null = null, memberId: string | null = null, nativeCollectionFieldId: string | null = null
  if (plan.collectionId) {
    const historical = await read(plan.collectionId, 9n)
    collectionRow = rewrite(historical, setupDigest, { version: '7' }, shared)
    const collection = SaleCollectionBcs.parse(collectionRow.contents.value)
    collectionHolder = collection.holder
    memberId = deriveDynamicFieldID(collection.members.id, '0x2::object::ID', bcs.Address.serialize(plan.soulId).toBytes())
    const member = setupObject(memberId, '0x2::dynamic_field::Field<0x2::object::ID,u64>', SaleCollectionMemberBcs.serialize({
      id: memberId, name: plan.soulId, value: variant === 'wrong-member-ordinal' ? 2 : 1,
    }).toBytes(), { ObjectOwner: collection.members.id })
    const nativeKey = `${target.native.originalPackageId}::birth::CollectionKey`
    nativeCollectionFieldId = deriveDynamicFieldID(terms.state, nativeKey, moveEmptyStructBytes())
    const CollectionField = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('CollectionKey', { dummy_field: bcs.bool() }), value: bcs.Address })
    const nativeField = setupObject(nativeCollectionFieldId, `0x2::dynamic_field::Field<${nativeKey},0x2::object::ID>`, CollectionField.serialize({
      id: nativeCollectionFieldId, name: { dummy_field: false }, value: variant === 'wrong-native-collection' ? aid(205) : plan.collectionId,
    }).toBytes(), { ObjectOwner: terms.state })
    stateInput = rewrite(await read(terms.state, 9n), setupDigest, { version: '7' })
    setupRows.push(collectionRow, member, nativeField, stateInput)
  }
  const setupEffects = setup.effectsData.V2!
  setupEffects.lamportVersion = '7'
  setupEffects.changedObjects = setupRows.filter(row => variant !== 'missing-directory' || row.objectId !== directoryId)
    .map(row => [row.objectId, { inputState: { NotExist: true }, outputState: { ObjectWrite: [row.digest, owner(row)] },
      idOperation: { Created: true } }]) as never
  setup.rehashEffects()
  for (const ref of plan.shared) {
    if ([plan.registryId, plan.configId, plan.policyId, plan.collectionId].includes(ref.objectId)) ref.initialSharedVersion = '7'
    if (ref.objectId === plan.offerId) ref.initialSharedVersion = '9'
  }
  const cancel = await nativeSaleCancellationFixture(plan.configId, { registryId: plan.registryId,
    native: target.native, custody: target.custody, outputVersion: 8, checkpoint: '80', terms,
    intent: { offerId: aid(210), soulId: plan.soulId, seller: terms.seller, kioskId: plan.sellerKioskId, accountId: aid(211) } })
  const { relist, rows, offer, listing, kioskOutput } = await nativeSaleRelistFixture(cancel, plan,
    variant === 'same-checkpoint' ? variant : '', terms, '90')
  const readonly = [config, registry, policy, ...(collectionRow ? [collectionRow] : [])].map(row => [row.objectId, { ReadOnlyRoot: [String(row.version), row.digest] }])
  relist.effectsData.V2!.unchangedConsensusObjects = readonly as never
  relist.rehashEffects()

  // The actual purchase must consume the exact relist Offer and reservation.
  // Rebuild its SDK bytes to name the new Offer birth version, then rehash each
  // actual sale output and its buyer Account's transaction-bound close marker.
  purchase.summaryData.sequence_number = variant === 'same-checkpoint' ? '80' : '100'
  Object.assign(purchase.transactionData.V1, bcs.TransactionData.parse(await buildNativeSaleGraph(plan).build()).V1)
  purchase.rehashTransaction()
  const saleDigest = purchase.ledger.digest, saleEffects = purchase.effectsData.V2!
  const soldListing = variant === 'substituted-listing' ? rewrite(listing, adigest(206), { version: '8' }) : listing
  const saleInputs = new Map([config, offer, soldListing, kioskOutput, soulBefore, ...(stateInput ? [stateInput] : [])].map(row => [row.objectId, row]))
  const saleRows = new Map<string, FixtureRow>()
  function install(row: FixtureRow) { saleRows.set(`${row.objectId}:${row.version}`, row) }
  for (const row of [...saleInputs.values(), ...setupRows]) install(row)
  for (const [id, effect] of saleEffects.changedObjects) {
    const input = saleInputs.get(id)
    if (input) effect.inputState = { $kind: 'Exist', Exist: [[String(input.version), input.digest], owner(input)] }
    if (!effect.outputState.ObjectWrite) continue
    const previous = await read(id, 10n)
    let contents = previous.contents.value
    if (id === plan.soulId) contents = bindOrigin(soulOutput)
    if (id === plan.offerId) contents = NativeOfferBcs.serialize({ ...terms, active: false, purchase: null }).toBytes()
    if (variant === 'wrong-collection-payout' && collectionHolder && previous.owner.address === collectionHolder) {
      const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
      const coin = Coin.parse(contents)
      contents = Coin.serialize({ ...coin, balance: BigInt(coin.balance) - 1n }).toBytes()
    }
    if (id === plan.buyerAccount.objectId && variant !== 'old-account-marker') {
      const account = CanonicalOwnedAccountBcs.parse(contents)
      account.authority!.closed_digest = fromBase58(saleDigest)
      contents = CanonicalOwnedAccountBcs.serialize(account).toBytes()
    }
    const rewritten = rewrite(previous, saleDigest, { contents },
      id === plan.offerId ? owner(offer) : id === plan.configId ? shared : undefined)
    effect.outputState = { $kind: 'ObjectWrite', ObjectWrite: [rewritten.digest, owner(rewritten)] }
    install(rewritten)
  }
  saleEffects.unchangedConsensusObjects = readonly.filter(([id]) => id !== plan.configId) as never
  purchase.rehashEffects()
  original.packet = { ...original.packet, digest: saleDigest, bytes: toBase64(purchase.ledger.transaction.bcs.value) }

  const cancellation = cancel.f
  const transactions = [setup, cancellation, relist, purchase]
  if (variant === 'same-checkpoint') {
    cancellation.contentsData.V2!.transactions.splice(2, Infinity,
      relist.contentsData.V2!.transactions[1], purchase.contentsData.V2!.transactions[1])
    cancellation.rehashContents()
  }
  const checkpoints = new Map([...transactions].reverse().map(tx => [tx.ledger.checkpoint, tx.checkpoint]))
  const ledgerService = {
    getServiceInfo: ledger.getServiceInfo,
    getTransaction: vi.fn(async ({ digest }: { digest: string }) => {
      const tx = transactions.find(value => value.ledger.digest === digest)
      if (!tx) throw Object.assign(Error('Unknown original'), { code: 'NOT_FOUND' })
      return { response: { transaction: tx.ledger } }
    }),
    getCheckpoint: vi.fn(async ({ checkpointId }: { checkpointId: { sequenceNumber: bigint } }) =>
      ({ response: { checkpoint: checkpoints.get(checkpointId.sequenceNumber) } })),
    getObject: vi.fn(async ({ objectId, version }: { objectId: string; version?: bigint }) => {
      if (version === undefined) {
        if (objectId === economics.foundation.callablePackageId) return { response: { object: pinnedFoundation } }
        if (objectId === target.native.callablePackageId) return { response: { object: purchase.pkg } }
        return ledger.getObject({ objectId })
      }
      const key = `${objectId}:${version}`
      const row = saleRows.get(key) ?? rows.get(key)
      if (row) return { response: { object: row } }
      return ledger.getObject({ objectId, version })
    }),
  }
  const review = { schema: 'soulidity.commerce.native-sale-lifecycle-case.v1', soulId: plan.soulId, seller: terms.seller,
    buyer: plan.buyer, cancelledOfferId: cancel.intent.offerId, purchasedOfferId: plan.offerId,
    cancelDigest: cancellation.ledger.digest, relistDigest: relist.ledger.digest, purchaseDigest: saleDigest, target, economics, collection: context.collection }
  return { review, purchaseText: JSON.stringify(original), client: { ledgerService }, signal: new AbortController().signal,
    offer, listing, setupDigest, plan, creator: terms.creator, collectionHolder, memberId, nativeCollectionFieldId,
    stateId: terms.state, purchaseRows: saleRows }
}
