import { bcs } from '@mysten/sui/bcs'
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { CollectionKioskListingFieldBcs, CollectionKioskRegistryBcs, CollectionPublicListingBcs,
  SoulPublicCollectionBcs, SoulPublicKioskBcs } from '@soulidity/sdk'
import { CollectionCommandCancelledBcs, CollectionCommandListedBcs } from '../../../web/lib/collections/collection-command-history'
import { buildCollectionCommandTransaction } from '../../../web/lib/collections/collection-command-operation'
import { collectionCommandMarker, type CollectionCommandRecord } from '../../../web/lib/collections/collection-command-plan'
import { prepareCollectionCommandPlan } from '../../../web/lib/collections/collection-command-state'
import { activityEvidenceFixture, adigest } from './activity-transaction-evidence'
import { collectionBuyFixture, installCollectionBuyAfterFixture } from './collection-buy'
import { addressGasEffect, addressGasWindow, cid } from './collection-command'

/** Actual signed SDK packets and canonical raw ledger projections for the
 * same purchase, new owner's list, and new owner's cancel. */
export async function collectionBuyerListingFixture(options: {
  newKiosk?: boolean; alternateRoot?: boolean; alternateListing?: boolean; missingCancellation?: boolean
} = {}) {
  const f = await collectionBuyFixture({ newKiosk: options.newKiosk, addressGas: true })
  installCollectionBuyAfterFixture(f)
  const { kioskPackageId: _kiosk, collectionTransferPolicyId: _policy, ...target } = f.target
  const shared = { Shared: { initialSharedVersion: '1' } }
  const listingId = cid(1800), capId = cid(1801)
  const kiosk = { ...f.buyerKiosk, item_count: 1 }
  const listing = { ...f.listing, id: listingId, seller: f.author, seller_kiosk_id: kiosk.id, price: '2000001',
    purchase_cap: { id: capId, kiosk_id: kiosk.id, item_id: f.right.id, min_price: '0' } }
  const markerId = collectionCommandMarker(kiosk.id, f.right.id, true)
  const marker = { id: markerId, name: { id: f.right.id, is_exclusive: true }, value: '0' }
  const purchasedRoot = f.current.get(f.c.id)

  if (options.alternateRoot) {
    const value = SoulPublicCollectionBcs.parse(purchasedRoot.contents.value)
    const sameCustody = f.full(f.c.id, f.types.collection, SoulPublicCollectionBcs, value, shared, '13', adigest(990))
    f.current.set(f.c.id, sameCustody)
  }

  async function command(action: 'list' | 'delist', checkpoint: bigint, version: string) {
    const listingObjectOnChainId = action === 'delist' ? listingId : null
    const plan = await prepareCollectionCommandPlan({ client: f.client, target, author: f.author, listingObjectOnChainId,
      request: { action, collectionId: f.c.id, priceAtomic: action === 'list' ? listing.price : null } })
    const tx = buildCollectionCommandTransaction(plan)
    tx.setSender(f.author); tx.setGasOwner(f.author); tx.setGasPrice(1); tx.setGasBudget(1000000); tx.setGasPayment([])
    tx.setExpiration({ ValidDuring: { ...addressGasWindow, nonce: Number(checkpoint) } })
    const data = new TransactionDataBuilder(tx.getData())
    data.inputs = data.inputs.map(input => {
      if (!input.UnresolvedObject) return input
      const { objectId } = input.UnresolvedObject, row = f.current.get(objectId)
      return Inputs.SharedObjectRef({ objectId, initialSharedVersion: String(row.owner.version),
        mutable: [kiosk.id, f.registry.id, listingObjectOnChainId].includes(objectId) })
    })
    const exact = data.build(), signed = await f.signer.signTransaction(exact)
    const digest = TransactionDataBuilder.getDigestFromBytes(exact)
    const record: CollectionCommandRecord = { schema: 'soulidity.collection-command.v1', plan,
      packet: { bytes: toBase64(exact), digest, expirationEpoch: '10', phase: 'SIGNED', signature: signed.signature } }

    const evidence = await activityEvidenceFixture()
    evidence.transactionData.V1 = bcs.TransactionData.parse(exact).V1
    const effects = evidence.effectsData.V2!
    Object.assign(effects, {
      status: { $kind: 'Success', Success: true }, executedEpoch: '9',
      gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: digest, gasObjectIndex: null, lamportVersion: version,
      changedObjects: [addressGasEffect(f.author)], unchangedConsensusObjects: [], dependencies: [], auxDataDigest: null,
    })
    const objectOwner = (row: { bcs: { value: Uint8Array } }) => bcs.Object.parse(row.bcs.value).owner
    function transition(objectId: string, after: ReturnType<typeof f.full> | null) {
      const before = f.current.get(objectId)
      effects.changedObjects.push([objectId, {
        inputState: before ? { $kind: 'Exist', Exist: [[String(before.version), before.digest], objectOwner(before)] } : { $kind: 'NotExist', NotExist: true },
        outputState: after ? { $kind: 'ObjectWrite', ObjectWrite: [after.digest, objectOwner(after)] } : { $kind: 'NotExist', NotExist: true },
        idOperation: !after ? { $kind: 'Deleted', Deleted: true } : before ? { $kind: 'None', None: true } : { $kind: 'Created', Created: true },
      }])
      if (after) f.current.set(objectId, after)
      else f.current.delete(objectId)
    }
    for (const objectId of action === 'list' ? [f.c.id, f.market.id] : [f.c.id]) {
      const row = f.current.get(objectId)
      effects.unchangedConsensusObjects.push([objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: [String(row.version), row.digest] }])
    }
    const kioskOwner = objectOwner(f.current.get(kiosk.id))
    transition(kiosk.id, f.full(kiosk.id, f.types.kiosk, SoulPublicKioskBcs, kiosk, kioskOwner, version, digest))
    if (action === 'list') transition(f.registry.id, f.full(f.registry.id, f.types.registry, CollectionKioskRegistryBcs,
      f.registry, shared, version, digest))
    const listingOwner = { Shared: { initialSharedVersion: action === 'list' ? version : '14' } }
    transition(listingId, f.full(listingId, f.types.listing, CollectionPublicListingBcs,
      action === 'list' ? listing : { ...listing, purchase_cap: null, is_active: false }, listingOwner, version, digest))
    effects.changedObjects.push([capId, { inputState: { $kind: 'NotExist', NotExist: true }, outputState: { $kind: 'NotExist', NotExist: true },
      idOperation: action === 'list' ? { $kind: 'Created', Created: true } : { $kind: 'Deleted', Deleted: true } }])
    transition(markerId, action === 'list' ? f.full(markerId, f.types.marker, CollectionKioskListingFieldBcs,
      marker, { ObjectOwner: kiosk.id }, version, digest) : null)

    evidence.eventsData.data = [{
      package_id: target.callablePackageId, transaction_module: 'market', sender: f.author,
      type_: { address: target.originalPackageId, module: 'market', name: action === 'list' ? 'CollectionListed' : 'CollectionListingCancelled', typeParams: [] },
      contents: action === 'list'
        ? CollectionCommandListedBcs.serialize({ listing_id: listingId, collection_id: f.c.id, right_id: f.right.id, seller: f.author, kiosk_id: kiosk.id, price: listing.price }).toBytes()
        : CollectionCommandCancelledBcs.serialize({ listing_id: listingId, collection_id: f.c.id, seller: f.author }).toBytes(),
    }]
    evidence.summaryData.epoch = '9'; evidence.summaryData.sequence_number = String(checkpoint)
    evidence.contentsData.V2!.transactions[1].user_signatures = [[fromBase64(signed.signature), null]]
    evidence.rehashTransaction()
    return { record, evidence }
  }

  const opened = await command('list', 43n, '14'), openedRow = f.current.get(listingId)
  if (options.alternateListing) {
    f.current.set(listingId, f.full(listingId, f.types.listing, CollectionPublicListingBcs, listing,
      { Shared: { initialSharedVersion: '14' } }, '15', adigest(991)))
  }
  const closed = await command('delist', 44n, '16')
  const transactions = new Map([
    [f.record.packet.digest, f.evidence.ledger], [opened.record.packet.digest, opened.evidence.ledger], [closed.record.packet.digest, closed.evidence.ledger],
  ])
  if (options.missingCancellation) transactions.delete(closed.record.packet.digest)
  f.client.ledgerService.getTransaction.mockImplementation(async ({ digest }: { digest: string }) => {
    const transaction = transactions.get(digest)
    if (!transaction) throw { code: 'NOT_FOUND' }
    return { response: { transaction: structuredClone(transaction) } }
  })
  const checkpoints = new Map([[42n, f.evidence.checkpoint], [43n, opened.evidence.checkpoint], [44n, closed.evidence.checkpoint]])
  f.client.ledgerService.getCheckpoint.mockImplementation(async ({ checkpointId }) =>
    ({ response: { checkpoint: structuredClone(checkpoints.get(checkpointId.sequenceNumber)) } }))
  return { f, opened, closed, listingId, purchasedRoot, openedRow }
}
