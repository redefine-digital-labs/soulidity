import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { vi } from 'vitest'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import { nativeSaleCancellationFixture } from './commerce-sale-cancellation'
import { purchaseRecoveryCleanupFixture } from './commerce-purchase-recovery-cleanup'
import { NativeExclusiveListingFieldBcs } from '../../../web/lib/soulidity/commerce/native-sale-cancellation'
import { NativeOfferBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { buildNativeSaleGraph, type NativeSaleGraphPlan } from '../../../web/lib/soulidity/commerce/native-sale-graph'

export async function nativeSaleRelistFixture(cancellation: Awaited<ReturnType<typeof nativeSaleCancellationFixture>>,
  plan: NativeSaleGraphPlan, variant = '', terms?: ReturnType<typeof NativeOfferBcs.parse>, checkpoint = '101') {
  const { f: cancelled, intent, listingId, inputVersion, outputVersion } = cancellation
  const relist = await activityEvidenceFixture({ empty: true })
  const version = outputVersion + 1
  const account = cancellation.rows.get(`${intent.accountId}:${inputVersion}`), gasId = aid(8)
  const gasInput = cancellation.rows.get(`${gasId}:${outputVersion}`)
  const tx = new Transaction()
  tx.setSender(intent.seller)
  tx.setGasOwner(intent.seller)
  tx.setGasBudget(900)
  tx.setGasPrice(1)
  tx.setGasPayment([{ objectId: gasId, version: outputVersion, digest: gasInput.digest }])
  tx.setExpiration({ Epoch: 6 })
  const shared = (objectId: string, mutable = false) => tx.sharedObjectRef({ objectId,
    initialSharedVersion: plan.shared.find(row => row.objectId === objectId)!.initialSharedVersion, mutable })
  tx.moveCall({
    target: `${plan.callablePackageId}::market::${plan.collectionId ? 'list_with_collection' : 'list'}`, typeArguments: [plan.coinType],
    arguments: [shared(plan.registryId), shared(plan.configId), shared(plan.policyId),
      ...(plan.collectionId ? [shared(plan.collectionId)] : []), shared(plan.sellerKioskId, true),
      tx.objectRef({ objectId: variant === 'wrong-account' ? aid(99) : intent.accountId, version: inputVersion, digest: account.digest }),
      tx.pure.id(plan.soulId), tx.pure.u64(terms?.ask ?? '101'), tx.pure.u64(terms?.root_revision ?? '1')],
  })
  if (variant === 'extra-command') tx.moveCall({ target: `${plan.callablePackageId}::market::noop` })
  relist.summaryData.sequence_number = variant === 'reversed-checkpoint' ? '99' : variant === 'same-checkpoint' ? String(cancelled.ledger.checkpoint) : checkpoint
  Object.assign(relist.transactionData.V1, bcs.TransactionData.parse(await tx.build()).V1)
  relist.rehashTransaction()
  const rows = new Map(cancellation.rows)
  const digest = relist.ledger.digest
  function output(id: string, type: string, contents: Uint8Array, owner: Parameters<typeof bcs.Owner.serialize>[0]) {
    const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: true,
      version, contents } }, owner, previousTransaction: digest, storageRebate: 0 }).toBytes()
    const raw = bcs.Object.parse(bytes).owner
    const row = { objectId: id, version: BigInt(version), digest: activityHash('Object', bytes), bcs: { value: bytes }, contents: { value: contents },
      previousTransaction: digest, objectType: normalizeStructTag(type),
      owner: raw.Shared ? { kind: 3, version: BigInt(raw.Shared.initialSharedVersion) }
        : raw.ObjectOwner ? { kind: 2, address: raw.ObjectOwner } : { kind: 1, address: raw.AddressOwner } }
    rows.set(`${id}:${version}`, row)
    return row
  }
  const sellerKiosk = rows.get(`${plan.sellerKioskId}:${variant === 'old-kiosk' ? inputVersion : outputVersion}`)
  const kioskOutput = output(plan.sellerKioskId, '0x2::kiosk::Kiosk', sellerKiosk.contents.value, { Shared: { initialSharedVersion: 1 } })
  const offerType = `${cancelled.deployment.originalPackageId}::market::Offer`
  const old = terms ?? NativeOfferBcs.parse(cancellation.rows.get(`${intent.offerId}:${inputVersion}`).contents.value)
  const purchaseCapId = terms?.purchase?.id ?? aid(79)
  const offer = output(plan.offerId, offerType, NativeOfferBcs.serialize({
    ...old, id: plan.offerId, registry: plan.registryId, config: plan.configId, policy: plan.policyId, collection: plan.collectionId,
    ask: variant === 'wrong-offer-ask' ? '102' : old.ask, purchase: { ...old.purchase!, id: purchaseCapId },
  }).toBytes(), { Shared: { initialSharedVersion: version } })
  const listing = output(listingId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', NativeExclusiveListingFieldBcs.serialize({
    id: listingId, name: { id: plan.soulId, is_exclusive: true }, value: 0,
  }).toBytes(), { ObjectOwner: variant === 'wrong-marker-owner' ? aid(99) : plan.sellerKioskId })
  const coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const gas = output(gasId, gasInput.objectType, coin.serialize({ id: gasId, balance: 994 }).toBytes(), { AddressOwner: intent.seller })
  function effect(after: typeof offer, before?: typeof offer) {
    const owner = (row: typeof offer) => bcs.Object.parse(row.bcs.value).owner
    return [after.objectId, { inputState: before ? { Exist: [[String(before.version), before.digest], owner(before)] } : { NotExist: true },
      outputState: { ObjectWrite: [after.digest, owner(after)] }, idOperation: before ? { None: true } : { Created: true } }]
  }
  relist.effectsData.V2!.lamportVersion = String(version)
  relist.effectsData.V2!.changedObjects = [effect(offer), effect(listing), effect(kioskOutput, sellerKiosk), effect(gas, gasInput)] as never
  relist.effectsData.V2!.gasObjectIndex = 3
  relist.rehashEffects()
  if (variant === 'same-checkpoint') {
    cancelled.contentsData.V2!.transactions.push(relist.contentsData.V2!.transactions[1])
    cancelled.rehashContents()
  }

  return { relist, rows, offer, listing, kioskOutput, purchaseCapId, digest }
}

export async function nativeSaleLifecycleFixture(variant = '') {
  const sale = await purchaseRecoveryCleanupFixture(), original = sale.original, plan = original.plan
  const cancellation = await nativeSaleCancellationFixture(variant === 'foreign-cancel-config' ? aid(99) : plan.configId)
  const { f: cancelled, intent, listingId } = cancellation
  const pin = ({ originalPackageId, callablePackageId, callableDigest }: typeof cancelled.deployment) =>
    ({ originalPackageId, callablePackageId, callableDigest })
  const ids = new Map([[plan.offerId, aid(77)], [plan.registryId, aid(71)], [plan.sellerKioskId, intent.kioskId], [plan.policyId, aid(73)]])
  plan.shared = plan.shared.map(row => ({
    ...row, objectId: ids.get(row.objectId) ?? row.objectId, initialSharedVersion: row.objectId === plan.offerId ? '11' : row.initialSharedVersion,
  }))
  const usesCollection = variant === 'collection' || variant === 'unbound-collection'
  if (usesCollection) {
    plan.collectionId = aid(78)
    plan.shared.push({ objectId: plan.collectionId, initialSharedVersion: '1', mutable: false })
    original.context.collection = pin(sale.content.deployment)
  }
  plan.offerId = aid(77)
  plan.registryId = aid(71)
  plan.policyId = aid(73)
  plan.sellerKioskId = intent.kioskId
  plan.soulId = intent.soulId
  plan.buyer = aid(88)
  plan.callablePackageId = cancelled.deployment.callablePackageId
  original.context.target = {
    ...original.context.target, native: pin(cancelled.deployment), custody: pin(cancellation.params.custody), registryId: plan.registryId,
  }
  original.context.reviewedSoulId = plan.soulId
  const purchase = await buildNativeSaleGraph(plan).build()
  original.packet = { ...original.packet, bytes: toBase64(purchase), digest: TransactionDataBuilder.getDigestFromBytes(purchase) }

  const { relist, rows, offer, listing, purchaseCapId, digest } = await nativeSaleRelistFixture(cancellation, plan, variant)

  const missing = () => Object.assign(Error('Not found'), { code: 'NOT_FOUND' })
  const ledgerService = {
    ...cancelled.client.ledgerService,
    getTransaction: vi.fn(async ({ digest: requested }: { digest: string }) => {
      if (requested === cancelled.ledger.digest) return { response: { transaction: cancelled.ledger } }
      if (requested === digest && variant !== 'missing-relist') return { response: { transaction: relist.ledger } }
      throw missing()
    }),
    getCheckpoint: vi.fn(async ({ checkpointId }: { checkpointId: { sequenceNumber: bigint } }) => ({
      response: { checkpoint: checkpointId.sequenceNumber === 100n ? cancelled.checkpoint : relist.checkpoint },
    })),
    getObject: vi.fn(async ({ objectId, version }: { objectId: string; version?: bigint }) => {
      if (version !== undefined) return { response: { object: rows.get(`${objectId}:${version}`) } }
      return cancelled.client.ledgerService.getObject({ objectId })
    }),
  }
  const review = {
    schema: 'soulidity.commerce.native-sale-lifecycle-case.v1', soulId: plan.soulId, seller: intent.seller, buyer: plan.buyer,
    cancelledOfferId: intent.offerId, purchasedOfferId: plan.offerId, cancelDigest: cancelled.ledger.digest, relistDigest: digest,
    purchaseDigest: original.packet.digest, target: original.context.target, economics: original.context.economics,
    collection: original.context.collection,
  }
  const proofRef = (row: typeof offer) => ({ version: String(row.version), digest: row.digest, writer: row.previousTransaction })
  const purchaseProof = {
    kind: 'native-sale-preparation.v1', history: { status: 'SETTLEMENT_CONFIRMED', checkpoint: '102', receipt: {
      money: { seller: intent.seller, sourceBinding: { soulBinding: { soulId: plan.soulId } }, requiresOriginalSourceBindingProof: false,
        reciprocalCollection: usesCollection && variant !== 'unbound-collection' ? { collectionId: plan.collectionId, soulId: plan.soulId } : null },
      custody: { buyer: plan.buyer }, cleanup: {},
      listingExit: { offerId: plan.offerId, listingId, purchaseCapId, offerInput: proofRef(offer), listingInput: proofRef(listing) },
      effectsReconciliation: { status: 'OBJECT_EFFECTS_ACCOUNTED' },
    } },
  }
  if (variant === 'substituted-offer') purchaseProof.history.receipt.listingExit.offerInput.digest = adigest(99)
  if (variant === 'substituted-marker') purchaseProof.history.receipt.listingExit.listingInput.writer = adigest(99)
  return { review, purchaseText: JSON.stringify(original), client: { ledgerService }, ledgerService, purchaseProof,
    plan, listingId, purchaseCapId, signal: new AbortController().signal }
}
