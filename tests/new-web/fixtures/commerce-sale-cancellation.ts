import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import { NativeOfferBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { CanonicalOwnedAccountBcs } from '../../../web/lib/soulidity/canonical-native-workbench'
import { NativeSaleCancelledBcs, NativeExclusiveListingFieldBcs } from '../../../web/lib/soulidity/commerce/native-sale-cancellation'

export async function nativeSaleCancellationFixture() {
  const f = await activityEvidenceFixture(), c = await activityEvidenceFixture()
  const p = f.packageData.data.Package!, cp = c.packageData.data.Package!
  c.deployment.originalPackageId = aid(44); c.deployment.callablePackageId = aid(45); cp.id = aid(45)
  cp.moduleMap = new Map([['account', new Uint8Array([1])]])
  cp.typeOriginTable = [{ moduleName: 'account', datatypeName: 'Account', package: aid(44) }]; c.rehashPackage()
  p.moduleMap = new Map([['market', new Uint8Array([1])]])
  p.typeOriginTable = ['Offer', 'Cancelled'].map(datatypeName => ({ moduleName: 'market', datatypeName, package: f.deployment.originalPackageId }))
  p.linkageTable = new Map([[aid(44), { upgradedId: aid(45), upgradedVersion: '2' }]]); f.rehashPackage()
  const intent = { offerId: aid(60), soulId: aid(61), seller: f.sender, kioskId: aid(62), accountId: aid(63) }
  const rows = new Map<string, any>(), changes: any[] = []
  function object(id: string, type: string, contents: Uint8Array, owner: any, version: number) {
    const previousTransaction = version === 10 ? f.ledger.digest : adigest(9)
    const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: true,
      version, contents } }, owner, previousTransaction, storageRebate: 0 }).toBytes()
    const row = { objectId: id, objectType: normalizeStructTag(type), version: BigInt(version), digest: activityHash('Object', bytes),
      bcs: { value: bytes }, contents: { value: contents }, previousTransaction,
      owner: owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 3, version: 1n } }
    rows.set(`${id}:${version}`, row); return { row, owner: bcs.Object.parse(bytes).owner }
  }
  function effect(id: string, a: ReturnType<typeof object>, b: ReturnType<typeof object> | null) {
    changes.push([id, { inputState: { Exist: [[String(a.row.version), a.row.digest], a.owner] },
      outputState: b ? { ObjectWrite: [b.row.digest, b.owner] } : { NotExist: true }, idOperation: b ? { None: true } : { Deleted: true } }])
  }
  const account = { id: intent.accountId, kiosk: intent.kioskId, owner: intent.seller,
    authority: { cap: { id: aid(64), for: intent.kioskId }, kiosk: intent.kioskId, owner: intent.seller, closed_digest: new Uint8Array() } }
  const accountObject = object(intent.accountId, `${aid(44)}::account::Account`, CanonicalOwnedAccountBcs.serialize(account).toBytes(), { AddressOwner: intent.seller }, 9)
  const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() }), gasId = aid(8), gasType = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
  const gasBefore = object(gasId, gasType, Coin.serialize({ id: gasId, balance: 1000 }).toBytes(), { AddressOwner: intent.seller }, 2)
  const tx = new Transaction(); tx.setSender(intent.seller); tx.setGasOwner(intent.seller); tx.setGasBudget(1000); tx.setGasPrice(1)
  tx.setGasPayment([{ objectId: gasId, version: 2, digest: gasBefore.row.digest }]); tx.setExpiration({ Epoch: 6 })
  tx.moveCall({ target: `${f.deployment.callablePackageId}::market::cancel`, arguments: [
    tx.sharedObjectRef({ objectId: intent.offerId, initialSharedVersion: 1, mutable: true }),
    tx.sharedObjectRef({ objectId: intent.kioskId, initialSharedVersion: 1, mutable: true }),
    tx.objectRef({ objectId: intent.accountId, version: 9, digest: accountObject.row.digest }),
  ] })
  Object.assign(f.transactionData.V1, bcs.TransactionData.parse(await tx.build()).V1); f.rehashTransaction()
  const offer = { id: intent.offerId, root: intent.soulId, state: aid(70), registry: aid(71), config: aid(72), config_revision: 8,
    policy: aid(73), seller: intent.seller, kiosk: intent.kioskId, creator: aid(74), royalty: 250, generation: 0, root_revision: 1,
    manifest: new Uint8Array(32).fill(1), collection: null, ask: 101, active: true,
    purchase: { id: aid(75), kiosk_id: intent.kioskId, item_id: intent.soulId, min_price: 0 } }
  const offerType = `${f.deployment.originalPackageId}::market::Offer`
  effect(intent.offerId, object(intent.offerId, offerType, NativeOfferBcs.serialize(offer).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9),
    object(intent.offerId, offerType, NativeOfferBcs.serialize({ ...offer, active: false, purchase: null }).toBytes(), { Shared: { initialSharedVersion: 1 } }, 10))
  const kioskBytes = SoulPublicKioskBcs.serialize({ id: intent.kioskId, profits: 0, owner: intent.seller, item_count: 1, allow_extensions: false }).toBytes()
  effect(intent.kioskId, object(intent.kioskId, '0x2::kiosk::Kiosk', kioskBytes, { Shared: { initialSharedVersion: 1 } }, 9),
    object(intent.kioskId, '0x2::kiosk::Kiosk', kioskBytes, { Shared: { initialSharedVersion: 1 } }, 10))
  const key = { id: intent.soulId, is_exclusive: true }, Key = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })
  const listingId = deriveDynamicFieldID(intent.kioskId, '0x2::kiosk::Listing', Key.serialize(key).toBytes())
  effect(listingId, object(listingId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', NativeExclusiveListingFieldBcs.serialize({ id: listingId, name: key, value: 0 }).toBytes(), intent.kioskId ? { ObjectOwner: intent.kioskId } : {}, 9), null)
  effect(gasId, gasBefore, object(gasId, gasType, Coin.serialize({ id: gasId, balance: 997 }).toBytes(), { AddressOwner: intent.seller }, 10))
  changes.push([offer.purchase.id, { inputState: { NotExist: true }, outputState: { NotExist: true }, idOperation: { Deleted: true } }])
  f.effectsData.V2!.changedObjects = changes; f.effectsData.V2!.gasObjectIndex = 3
  f.eventsData.data = [{ package_id: f.deployment.callablePackageId, transaction_module: 'market', sender: intent.seller,
    type_: { address: f.deployment.originalPackageId, module: 'market', name: 'Cancelled', typeParams: [] },
    contents: NativeSaleCancelledBcs.serialize({ offer: intent.offerId, root: intent.soulId, seller: intent.seller }).toBytes() }]; f.rehashEvents()
  f.client.ledgerService.getObject.mockImplementation(async ({ objectId, version }: any) => ({ response: {
    object: version === undefined ? objectId === aid(45) ? c.pkg : f.pkg : rows.get(`${objectId}:${version}`) } }))
  return { f, rows, intent, listingId, params: { client: f.client as any, native: f.deployment, custody: c.deployment, intent,
    packet: { bytes: toBase64(f.ledger.transaction.bcs.value), digest: f.ledger.digest, expirationEpoch: '6', phase: 'SIGNED' as const, signature: 'fixture' }, signal: new AbortController().signal } }
}
