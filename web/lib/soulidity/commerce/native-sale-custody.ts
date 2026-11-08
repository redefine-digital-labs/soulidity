import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, toHex } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { CanonicalSoulBcs, CanonicalOwnedAccountBcs } from '../canonical-native-workbench'
import { commerceCheck, decodeCommerce } from './economics-read'
import type { NativeSoldExpectation } from './native-sale-receipt'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'

const Lock = bcs.struct('Lock', { id: bcs.Address, name: bcs.struct('Key', { id: bcs.Address }), value: bcs.bool() })

/** Original custody-output proof. Parent must authenticate effects/finality
 * and Sold/Paid; this never grants current permissions or proves all recursive
 * source cleanup, funds or content usability. Latest state cannot substitute
 * for the original buyer delivery when a Soul has subsequently moved again.
 */
export async function proveNativeSaleCustody(input: { client: SuiGrpcClient; effects: ReturnType<typeof bcs.TransactionEffects.parse>;
  transactionDigest: string; expected: Pick<NativeSoldExpectation, 'root' | 'seller' | 'buyer' | 'sellerKiosk' | 'buyerKiosk'>; buyerAccountId: string;
  native: PinnedMovePackage; standard: PinnedMovePackage; custody: PinnedMovePackage; signal: AbortSignal }) {
  const expected = structuredClone(input.expected), effects = structuredClone(input.effects)
  const { signal, transactionDigest } = input, buyerAccountId = input.buyerAccountId
  const pins = structuredClone({ native: input.native, standard: input.standard, custody: input.custody })
  const ledger = input.client.ledgerService
  const client = { ledgerService: { getObject: ledger.getObject.bind(ledger) } } as unknown as SuiGrpcClient
  commerceCheck(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === transactionDigest
    && effects.V2.changedObjects.length <= 4096 && new Set(effects.V2.changedObjects.map(([id]) => id)).size === effects.V2.changedObjects.length
    && expected.seller !== expected.buyer && expected.sellerKiosk !== expected.buyerKiosk, 'CUSTODY_CONTEXT')
  const native = await readPinnedMovePackage(client, pins.native, signal)
  const standard = await readPinnedMovePackage(client, pins.standard, signal)
  const custody = await readPinnedMovePackage(client, pins.custody, signal)
  for (const pkg of [standard, custody]) {
    const link = native.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'CUSTODY_LINK')
  }
  const rootOrigin = standard.origins.get('soul::Soul'), accountOrigin = custody.origins.get('account::Account')
  commerceCheck(rootOrigin && accountOrigin, 'CUSTODY_ORIGINS')
  const read = (objectId: string, type: string, mode: 'input' | 'mutated' | 'created') => readHistoricalMoveObject({
    client, effects, transactionDigest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const rootType = `${rootOrigin}::soul::Soul`, accountType = `${accountOrigin}::account::Account`
  const before = await read(expected.root, rootType, 'input'), after = await read(expected.root, rootType, 'mutated')
  const rootBefore = decodeCommerce(CanonicalSoulBcs, before.bytes), rootAfter = decodeCommerce(CanonicalSoulBcs, after.bytes)
  const sellerItem = deriveKioskItemFieldId(expected.sellerKiosk, expected.root), buyerItem = deriveKioskItemFieldId(expected.buyerKiosk, expected.root)
  commerceCheck(before.object.owner.ObjectOwner === sellerItem && after.object.owner.ObjectOwner === buyerItem
    && rootBefore.id === expected.root && rootAfter.id === expected.root && rootBefore.schema === 1 && rootAfter.schema === 1
    && !rootBefore.editing && !rootAfter.editing && rootBefore.name === rootAfter.name
    && JSON.stringify(rootBefore.origin) === JSON.stringify(rootAfter.origin)
    && BigInt(rootAfter.revision) > BigInt(rootBefore.revision), 'CUSTODY_ROOT_HANDOVER')
  const oldItem = await read(sellerItem, KIOSK_ITEM_FIELD_TYPE, 'input')
  const oldEffect = effects.V2.changedObjects.find(([id]) => id === sellerItem)![1]
  commerceCheck(oldItem.object.owner.ObjectOwner === expected.sellerKiosk
    && assertKioskItemField(oldItem.bytes, expected.sellerKiosk, expected.root) === sellerItem
    && oldEffect.idOperation.$kind === 'Deleted' && oldEffect.outputState.$kind === 'NotExist', 'CUSTODY_SELLER_ITEM_REMOVED')
  const item = await read(buyerItem, KIOSK_ITEM_FIELD_TYPE, 'created')
  commerceCheck(item.object.owner.ObjectOwner === expected.buyerKiosk
    && assertKioskItemField(item.bytes, expected.buyerKiosk, expected.root) === buyerItem, 'CUSTODY_BUYER_ITEM')
  const lockId = deriveDynamicFieldID(expected.buyerKiosk, '0x2::kiosk::Lock', bcs.Address.serialize(expected.root).toBytes())
  const lockObject = await read(lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', 'created')
  const lock = decodeCommerce(Lock, lockObject.bytes)
  commerceCheck(lock.id === lockId && lock.name.id === expected.root && lock.value
    && lockObject.object.owner.ObjectOwner === expected.buyerKiosk, 'CUSTODY_BUYER_LOCK')
  const sellerLockId = deriveDynamicFieldID(expected.sellerKiosk, '0x2::kiosk::Lock', bcs.Address.serialize(expected.root).toBytes())
  const sellerLockObject = await read(sellerLockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', 'input')
  const sellerLock = decodeCommerce(Lock, sellerLockObject.bytes), lockExit = effects.V2.changedObjects.find(([id]) => id === sellerLockId)![1]
  commerceCheck(sellerLock.id === sellerLockId && sellerLock.name.id === expected.root && sellerLock.value
    && sellerLockObject.object.owner.ObjectOwner === expected.sellerKiosk
    && lockExit.idOperation.$kind === 'Deleted' && lockExit.outputState.$kind === 'NotExist', 'CUSTODY_SELLER_LOCK_REMOVED')
  const kioskInputs: Array<{objectId:string;initialSharedVersion:string}> = []
  for (const [id, owner, delta] of [[expected.sellerKiosk, expected.seller, -1n], [expected.buyerKiosk, expected.buyer, 1n]] as const) {
    const prior = await read(id, '0x2::kiosk::Kiosk', 'input'), current = await read(id, '0x2::kiosk::Kiosk', 'mutated')
    const a = decodeCommerce(SoulPublicKioskBcs, prior.bytes), b = decodeCommerce(SoulPublicKioskBcs, current.bytes)
    commerceCheck(prior.object.owner.$kind === 'Shared' && current.object.owner.$kind === 'Shared'
      && a.id === id && b.id === id && a.owner === owner && b.owner === owner && !a.allow_extensions && !b.allow_extensions
      && prior.object.owner.Shared!.initialSharedVersion === current.object.owner.Shared!.initialSharedVersion
      && BigInt(b.item_count) === BigInt(a.item_count) + delta
      && publicMutationCanonical({ ...a, item_count: null }) === publicMutationCanonical({ ...b, item_count: null }), 'CUSTODY_KIOSK')
    kioskInputs.push({objectId:id,initialSharedVersion:prior.object.owner.Shared!.initialSharedVersion})
  }
  const accountInput = await read(buyerAccountId, accountType, 'input'), accountBefore = decodeCommerce(CanonicalOwnedAccountBcs, accountInput.bytes)
  const accountObject = await read(buyerAccountId, accountType, 'mutated')
  const account = decodeCommerce(CanonicalOwnedAccountBcs, accountObject.bytes), authority = account.authority
  commerceCheck(accountInput.object.owner.AddressOwner === expected.buyer && accountObject.object.owner.AddressOwner === expected.buyer
    && accountBefore.authority && account.id === buyerAccountId
    && account.owner === expected.buyer && account.kiosk === expected.buyerKiosk && authority
    && authority.owner === expected.buyer && authority.kiosk === expected.buyerKiosk && authority.cap.for === expected.buyerKiosk
    && toHex(authority.closed_digest) === toHex(fromBase58(transactionDigest))
    && publicMutationCanonical({ ...accountBefore, authority: { ...accountBefore.authority, closed_digest: null } })
      === publicMutationCanonical({ ...account, authority: { ...authority, closed_digest: null } }), 'CUSTODY_ACCOUNT_CLOSURE')
  return { proof: 'native-sale-original-custody-outputs-only' as const, transactionDigest, soulId: expected.root,
    buyerKioskId: expected.buyerKiosk, buyerAccountId: account.id, rootRevision: rootAfter.revision,
    buyerAccountInput: { objectId: account.id, version: String(accountInput.reference.version), digest: accountInput.reference.digest },
    sellerLockId, buyerLockId: lockId, kioskInputs,
    claimedEffectIds: [expected.root, sellerItem, buyerItem, sellerLockId, lockId, expected.sellerKiosk, expected.buyerKiosk, account.id],
    notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
