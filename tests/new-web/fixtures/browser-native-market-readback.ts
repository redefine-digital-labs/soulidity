import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase58 } from '@mysten/sui/utils'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { nativeReceiveFixture, fixtureKioskItem } from './native-receive'
import { marketListFixture, marketListEventEvidence, lid } from './market-list-operation'
import { marketBuyFixture, marketBuyEventEvidence } from './market-buy-operation'
import { marketCancelFixture, cancelEventEvidence } from './market-cancel-operation'
import { NativeSoulBcs, NativeSoulStateBcs, NativeSoulBindingBcs } from '../../../web/lib/animacraft/native-receive'
import { NativeMarketListingBcs } from '../../../web/lib/animacraft/native-market'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { confirmBrowserNativeMarketBuy, confirmBrowserNativeMarketList, confirmBrowserNativeMarketCancel } from '../../../web/lib/animacraft/browser-native-market-readback'

export async function browserNativeMarketReadbackFixture(kind: 'buy' | 'list' | 'reprice' | 'cancel-listing' = 'list', newKiosk = false) {
  const native = nativeReceiveFixture(), { target, objects } = native
  const base = kind === 'buy' ? await marketBuyFixture({ newKiosk }) : kind === 'cancel-listing' ? await marketCancelFixture() : await marketListFixture({ kind,marketConfigV2Id:lid(206) })
  const record = base.record
  const snapshot = record.kind === 'cancel-listing' ? record : record.snapshot
  snapshot.release.soulidityCallableDigest = target.soulidityCallableDigest
  if ('soulidityOriginalPackageId' in snapshot.release) snapshot.release.soulidityOriginalPackageId = target.soulidityOriginalPackageId
  record.phase = 'SUCCEEDED'; record.syncStatus = 'PENDING'
  const events = record.kind === 'buy' ? marketBuyEventEvidence(record) : record.kind === 'cancel-listing'
    ? cancelEventEvidence(record, data => { data.data[0].type_.address = target.soulidityOriginalPackageId }) : marketListEventEvidence(record)
  const digest = (n = 3) => toBase58(new Uint8Array(32).fill(n))
  for (const row of objects.values()) {
    row.digest = digest()
    if (!row.package) row.version = 3n
    if (row.owner.kind === 3) row.owner.version = 1n
  }
  const pkg = objects.get(lid(5)).package
  for (const datatypeName of ['MarketConfigV2', 'SoulListing', 'SoulListed', 'SoulListingCancelled', 'AnimacraftV8SoulPurchased'])
    pkg.typeOrigins.push({ moduleName: 'market', datatypeName, packageId: target.soulidityOriginalPackageId })
  const edit = (id: string, codec: any, change: (value: any) => void, map = objects) => {
    const row = map.get(id), value = codec.parse(row.contents.value)
    change(value); row.contents.value = codec.serialize(value).toBytes()
  }
  const owner = record.kind === 'buy' ? record.snapshot.buyer : record.kind === 'cancel-listing' ? record.owner : record.snapshot.owner
  const kioskId = record.kind === 'buy' ? record.snapshot.buyerKioskId ?? lid(45) : record.kind === 'cancel-listing' ? record.kioskId : record.snapshot.kioskId
  const creator = record.kind === 'cancel-listing' ? lid(71) : record.snapshot.creator
  const maker = record.kind === 'cancel-listing' ? lid(72) : record.snapshot.makerCreator
  const listed = kind === 'list' || kind === 'reprice'
  edit(lid(14), NativeSoulStateBcs, state => Object.assign(state, { creator, creator_royalty_bps: 250,
    current_owner: owner, current_kiosk_id: kioskId, ownership_epoch: record.kind === 'buy' ? '4' : '3', is_listed: listed }))
  edit(lid(12), NativeSoulBcs, soul => { soul.creator = creator })
  const itemFieldId = fixtureKioskItem(objects, kioskId, lid(12))
  if (kind === 'buy') for (const id of [itemFieldId, lid(12)]) objects.get(id).previousTransaction = record.digest
  edit(lid(13), NativeSoulBindingBcs, binding => {
    binding.original_holder = creator; binding.maker_creator = maker
    binding.rights.soul_creator_royalty_bps = 250; binding.rights.maker_source_royalty_bps = 750
  })
  objects.set(kioskId, { objectId: kioskId, version: 3n, digest: digest(), owner: { kind: 3, version: kind === 'buy' && newKiosk ? 3n : 1n },
    objectType: '0x2::kiosk::Kiosk', contents: { value: SoulPublicKioskBcs.serialize({ id: kioskId, profits: '0', owner, item_count: 1, allow_extensions: true }).toBytes() } })
  const listingId = listed ? lid(23) : lid(22)
  objects.set(listingId, { objectId: listingId, version: 3n, digest: digest(), owner: { kind: 3, version: listed ? 3n : 1n },
    objectType: `${target.soulidityOriginalPackageId}::market::SoulListing`, contents: { value: NativeMarketListingBcs.serialize({
      id: listingId, version: '8', soul_id: lid(12), state_id: lid(14), seller: owner, seller_kiosk_id: kioskId, price: '1000000', creator,
      creator_royalty_bps: 250, collection_id: null, purchase_cap: listed ? { id: lid(33), kiosk_id: kioskId, item_id: lid(12), min_price: '0' } : null, is_active: listed,
    }).toBytes() } })
  const history = new Map<string, any>([...objects.entries()].map(([id, row]) => [id, structuredClone(row)]))
  const sellerFieldId = record.kind === 'buy' ? deriveKioskItemFieldId(record.snapshot.sellerKioskId, lid(12)) : null
  if (record.kind === 'buy') history.set(sellerFieldId!, { objectId: sellerFieldId, version: 2n, digest: digest(2),
    owner: { kind: 2, address: record.snapshot.sellerKioskId }, objectType: KIOSK_ITEM_FIELD_TYPE,
    contents: { value: KioskItemFieldBcs.serialize({ id: sellerFieldId!, name: { name: { id: lid(12) } }, value: lid(12) }).toBytes() } })
  if (record.kind === 'buy') history.set(`${lid(12)}:2`, { ...structuredClone(history.get(lid(12))), version: 2n,
    digest: digest(2), previousTransaction: digest(2), owner: { kind: 2, address: sellerFieldId } })
  const change = (id: string, created = false) => [id, { inputState: created ? { NotExist: true } : { Exist: [['2', digest(2)], { Shared: { initialSharedVersion: '1' } }] },
    outputState: { ObjectWrite: [digest(), { Shared: { initialSharedVersion: created ? '3' : '1' } }] }, idOperation: created ? { Created: true } : { None: true } }]
  const effects: any = { V2: { status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: record.digest, gasObjectIndex: null, eventsDigest: events.digest, dependencies: [], lamportVersion: '3',
    changedObjects: [change(lid(14)), ...(listed ? [change(listingId, true)] : []), ...(kind === 'buy' && newKiosk ? [change(kioskId, true)] : [])], unchangedConsensusObjects: [], auxDataDigest: null } }
  if (record.kind === 'buy') effects.V2.changedObjects.push(
    [itemFieldId, { inputState: { NotExist: true }, outputState: { ObjectWrite: [digest(), { ObjectOwner: kioskId }] }, idOperation: { Created: true } }],
    [lid(12), { inputState: { Exist: [['2', digest(2)], { ObjectOwner: sellerFieldId }] },
      outputState: { ObjectWrite: [digest(), { ObjectOwner: itemFieldId }] }, idOperation: { None: true } }],
    [sellerFieldId, { inputState: { Exist: [['2', digest(2)], { ObjectOwner: record.snapshot.sellerKioskId }] },
      outputState: { NotExist: true }, idOperation: { Deleted: true } }])
  const ledger: any = { digest: record.digest, transaction: { digest: record.digest, bcs: { value: base.bytes } },
    effects: { transactionDigest: record.digest, bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() }, status: { success: true } }, events, checkpoint: 20n }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation((async (request: any) => ({ response: {
    object: structuredClone(request.version === undefined ? objects.get(request.objectId)
      : history.get(`${request.objectId}:${request.version}`) ?? history.get(request.objectId)),
  } })) as any)
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation((async (request: any) => ({ response: {
    objects: request.requests.map((request: any) => ({ result: objects.has(request.objectId)
      ? { oneofKind: 'object', object: structuredClone(objects.get(request.objectId)) } : { oneofKind: 'error', error: { code: 5 } } })),
  } })) as any)
  vi.spyOn(client.ledgerService, 'getServiceInfo').mockImplementation((async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } })) as any)
  const transaction = vi.spyOn(client.ledgerService, 'getTransaction').mockImplementation((async () => ({ response: { transaction: ledger } })) as any)
  vi.spyOn(client.core, 'getChainIdentifier').mockImplementation(native.client.core.getChainIdentifier)
  vi.spyOn(client.core, 'getDynamicField').mockImplementation(native.client.core.getDynamicField)
  const execute = vi.spyOn(client.core, 'executeTransaction').mockImplementation(async () => { throw new Error('No execution during readback') })
  const refreshEffects = () => { ledger.effects.bcs.value = bcs.TransactionEffects.serialize(effects).toBytes() }
  const confirm = (signal?: AbortSignal) => record.kind === 'buy' ? confirmBrowserNativeMarketBuy(record, { target, signal }, { client })
    : record.kind === 'cancel-listing' ? confirmBrowserNativeMarketCancel(record, { target, signal }, { client })
      : confirmBrowserNativeMarketList(record, { target, signal }, { client })
  const later = (mutate: (state: any) => void) => {
    const row = objects.get(lid(14)); row.version = 4n; row.digest = digest(4)
    edit(lid(14), NativeSoulStateBcs, mutate)
  }
  return { record, target, objects, history, edit, get, batch, transaction, execute, effects, refreshEffects, ledger,
    digest, owner, creator, kioskId, listingId, sellerFieldId, client, confirm, later }
}
