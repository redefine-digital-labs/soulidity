import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, fromHex, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicKioskBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { CanonicalOwnedAccountBcs, readCanonicalNativeWorkbench } from '../canonical-native-workbench'
import { readNativeManagementState } from '../management/native-state'
import type { NativeSaleCheckoutRelease } from '../native-sale-checkout-config'
import { readSaleCollectionProof } from './collection-sale-proof'
import { commerceCheck as check, commerceId, decodeCommerce, readCommerceObject, readEconomicsIncome } from './economics-read'
import { NativeOfferBcs } from './economics-bcs'
import { assertNativeMarketRole } from './native-offer-read'
import { NativeExclusiveListingFieldBcs } from './native-sale-cancellation'
import { NativeMarketRuleFieldBcs, NativeTransferPolicyBcs } from './native-sale-conditions'
import { readNativeSaleGasCoins } from './native-sale-funding'
import type { NativeSaleGraphPlan } from './native-sale-graph'
import { quoteNativeSale } from './native-sale-quote'
import { readNativeSaleSourceBinding } from './native-sale-source-binding'
import { nativeSaleSoulManifest, readNativeSaleTree } from './native-sale-tree'

type SaleGas = NativeSaleGraphPlan['gas']
type Shared = NativeSaleGraphPlan['shared'][number]
type Ref = SaleGas['coins'][number]
export type NativeSellerIntent = {
  soulId: string; seller: string; accountId: string
} & ({ kind: 'LIST'; policyId: string; ask: string; collectionId: string | null } | { kind: 'CANCEL'; offerId: string })
type SaleSnapshot = {
  state: string; creator: string; royalty: number; config_revision: string; generation: string;
  rootRevision: string; manifestHex: string
}
export interface NativeSellerPlan {
  release: NativeSaleCheckoutRelease
  intent: NativeSellerIntent
  kioskId: string
  account: Ref
  shared: Shared[]
  snapshot: SaleSnapshot | null
  offerDigest: string | null
  gas: SaleGas
  expirationEpoch: string
}

const U = bcs.u64(), A = bcs.Address
const KioskType = '0x2::kiosk::Kiosk', ListingType = '0x2::kiosk::Listing'
const ListingKey = bcs.struct('Listing', { id: A, is_exclusive: bcs.bool() })
const Lock = bcs.struct('Field', { id: A, name: bcs.struct('Lock', { id: A }), value: bcs.bool() })
const CollectionField = bcs.struct('Field', { id: A, name: MoveEmptyStructBcs, value: A })
const uint = (value: string, positive = true) => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= (1n << 64n) - 1n && (!positive || value !== '0')
const ref = ({ objectId, version, digest }: Ref): Ref => ({ objectId, version, digest })
const birth = (row: Awaited<ReturnType<typeof readCommerceObject>>, mutable: boolean): Shared => {
  const initialSharedVersion = row.owner.Shared?.initialSharedVersion
  check(initialSharedVersion && uint(initialSharedVersion) && BigInt(initialSharedVersion) <= BigInt(row.version), 'SELLER_SHARED_OWNER')
  return { objectId: row.objectId, initialSharedVersion, mutable }
}

function validateIntent(intent: NativeSellerIntent) {
  check([intent.soulId, intent.seller, intent.accountId].every(commerceId)
    && (intent.kind === 'LIST' ? commerceId(intent.policyId) && uint(intent.ask)
      && (intent.collectionId === null || commerceId(intent.collectionId)) : intent.kind === 'CANCEL' && commerceId(intent.offerId)), 'SELLER_INTENT')
}

type Request = {
  release: NativeSaleCheckoutRelease; intent: NativeSellerIntent; client: SuiGrpcClient;
  signal: AbortSignal; getSellerAddress: () => string | null
}

/** Current seller authority and exact market data. Cancellation intentionally
 * uses no economics Config, market policy or content directory. */
async function readSellerState(input: Request) {
  const { release, intent, client, signal, getSellerAddress } = input
  const { target, economics, collection } = release
  const guard = () => { signal.throwIfAborted(); check(getSellerAddress() === intent.seller, 'SELLER_WALLET_CHANGED') }
  validateIntent(intent); guard()
  check(target.chainIdentifier === '35834a8a' && target.custody && target.configId === economics.configId, 'SELLER_RELEASE')
  const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'SELLER_CHAIN')
  const [native, custody] = await Promise.all([readPinnedMovePackage(client, target.native, signal),
    readPinnedMovePackage(client, target.custody, signal)])
  function type(pkg: typeof native, module: string, name: string) {
    const origin = pkg.origins.get(module + '::' + name)
    check(origin, 'SELLER_TYPE_ORIGIN')
    return origin + '::' + module + '::' + name
  }
  const custodyLink = native.linkage.get(custody.pin.originalPackageId)
  check(custodyLink?.upgradedId === custody.pin.callablePackageId && custodyLink.upgradedVersion === String(custody.version), 'SELLER_CUSTODY_LINK')
  const accountType = type(custody, 'account', 'Account')
  const accountRow = await readCommerceObject(client, intent.accountId, accountType, signal)
  const account = decodeCommerce(CanonicalOwnedAccountBcs, accountRow.contents)
  const authority = account.authority
  check(accountRow.owner.AddressOwner === intent.seller && account.id === intent.accountId && account.owner === intent.seller
    && authority?.owner === intent.seller && authority.kiosk === account.kiosk && authority.cap.for === account.kiosk
    && commerceId(authority.cap.id) && [0, 32].includes(authority.closed_digest.length), 'SELLER_ACCOUNT_PAIR')
  const kioskId = account.kiosk
  const kioskRow = await readCommerceObject(client, kioskId, KioskType, signal), kiosk = decodeCommerce(SoulPublicKioskBcs, kioskRow.contents)
  check(kiosk.id === kioskId && kiosk.owner === intent.seller && !kiosk.allow_extensions && kiosk.item_count > 0
    && new Set([intent.soulId, kioskId, account.id, authority.cap.id]).size === 4, 'SELLER_KIOSK')
  const sharedKiosk = birth(kioskRow, true)
  const lockId = deriveDynamicFieldID(kioskId, '0x2::kiosk::Lock', A.serialize(intent.soulId).toBytes())
  const lockRow = await readCommerceObject(client, lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', signal)
  const lock = decodeCommerce(Lock, lockRow.contents)
  check(lock.id === lockId && lock.name.id === intent.soulId && lock.value && lockRow.owner.ObjectOwner === kioskId, 'SELLER_LOCK')
  const pair = { kioskId, account: ref(accountRow) }

  if (intent.kind === 'CANCEL') {
    const offerRow = await readCommerceObject(client, intent.offerId, type(native, 'market', 'Offer'), signal)
    const offer = decodeCommerce(NativeOfferBcs, offerRow.contents), cap = offer.purchase
    check(offer.id === intent.offerId && offer.root === intent.soulId && offer.seller === intent.seller && offer.kiosk === kioskId
      && offer.registry === target.registryId && offer.config === target.configId && offer.active && cap && commerceId(cap.id)
      && cap.item_id === intent.soulId && cap.kiosk_id === kioskId && cap.min_price === '0', 'SELLER_CANCEL_OFFER')
    const id = deriveDynamicFieldID(kioskId, ListingType, ListingKey.serialize({ id: intent.soulId, is_exclusive: true }).toBytes())
    const row = await readCommerceObject(client, id, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', signal)
    const listing = decodeCommerce(NativeExclusiveListingFieldBcs, row.contents)
    check(row.owner.ObjectOwner === kioskId && listing.id === id && listing.name.id === intent.soulId
      && listing.name.is_exclusive && listing.value === '0', 'SELLER_CANCEL_RESERVATION')
    guard()
    return { ...pair, shared: [birth(offerRow, true), sharedKiosk], snapshot: null, offerDigest: offerRow.digest, quote: null }
  }

  const [standard, income, root, management] = await Promise.all([
    readPinnedMovePackage(client, target.standard, signal),
    readEconomicsIncome({ client, target: economics, signal }),
    readCanonicalNativeWorkbench({ client, target, soulId: intent.soulId, viewerAddress: intent.seller, signal }),
    readNativeManagementState({ client, target, soulId: intent.soulId, viewerAddress: intent.seller, getViewerAddress: getSellerAddress, signal }),
  ])
  check(root.custody?.ownerReadCandidate && root.custody.kioskId === kioskId && root.custody.accountId === intent.accountId
    && root.stateId === management.stateId, 'SELLER_CURRENT_ROOT')
  assertNativeMarketRole(native, income)
  check(income.config.enabled && !income.config.paused && BigInt(income.config.minimum_release) <= 2n, 'SELLER_MARKET_PAUSED')
  const source = await readNativeSaleSourceBinding({ client, economics, native: target.native, registryId: target.registryId,
    soulId: intent.soulId, stateId: root.stateId, signal })
  check(source.gates.secondary && source.config.digest === income.object.digest, 'SELLER_SECONDARY_GATE')
  const policyRow = await readCommerceObject(client, intent.policyId, '0x2::transfer_policy::TransferPolicy<' + type(standard, 'soul', 'Soul') + '>', signal)
  const policy = decodeCommerce(NativeTransferPolicyBcs, policyRow.contents), rule = type(native, 'market', 'Rule')
  check(policy.id === intent.policyId && policy.rules.contents.length === 1
    && normalizeStructTag(policy.rules.contents[0].name) === rule, 'SELLER_POLICY_RULES')
  const key = '0x2::transfer_policy::RuleKey<' + rule + '>', ruleId = deriveDynamicFieldID(intent.policyId, key, moveEmptyStructBytes())
  const ruleRow = await readCommerceObject(client, ruleId, '0x2::dynamic_field::Field<' + key + ',' + type(native, 'market', 'RuleConfig') + '>', signal)
  const ruleField = decodeCommerce(NativeMarketRuleFieldBcs, ruleRow.contents)
  check(ruleRow.owner.ObjectOwner === intent.policyId && ruleField.id === ruleId && !ruleField.name.dummy_field
    && ruleField.value.config === target.configId && normalizeStructTag(ruleField.value.currency.name) === economics.coinType, 'SELLER_POLICY_BINDING')
  const rootRow = await readCommerceObject(client, intent.soulId, type(standard, 'soul', 'Soul'), signal)
  const manifest = nativeSaleSoulManifest(rootRow.contents)
  await readNativeSaleTree({ client, target, soulId: intent.soulId, expectedRevision: root.revision, expectedManifest: manifest, signal })
  const collectionKey = type(native, 'birth', 'CollectionKey'), collectionFieldId = deriveDynamicFieldID(root.stateId, collectionKey, moveEmptyStructBytes())
  let attached: string | null = null
  try {
    const row = await readCommerceObject(client, collectionFieldId, '0x2::dynamic_field::Field<' + collectionKey + ',0x2::object::ID>', signal)
    const field = decodeCommerce(CollectionField, row.contents)
    check(row.owner.ObjectOwner === root.stateId && field.id === collectionFieldId && !field.name.dummy_field, 'SELLER_COLLECTION_FIELD')
    attached = field.value
  } catch (error) {
    signal.throwIfAborted()
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND')) throw error
  }
  check(attached === intent.collectionId, 'SELLER_COLLECTION_SELECTION')
  let collectionRef: Shared[] = [], collectionBps = 0
  if (intent.collectionId) {
    check(collection, 'SELLER_COLLECTION_PIN')
    const member = await readSaleCollectionProof({ client, pin: collection, nativeLinkage: native.linkage,
      collectionId: intent.collectionId, configId: target.configId, soulId: intent.soulId, signal })
    check(member.creator === root.creator, 'SELLER_COLLECTION_CREATOR')
    const pkg = await readPinnedMovePackage(client, collection, signal)
    const row = await readCommerceObject(client, intent.collectionId, type(pkg, 'collection', 'Collection'), signal)
    check(row.digest === member.observed.digest, 'SELLER_COLLECTION_CHANGED')
    collectionRef = [birth(row, false)]; collectionBps = member.royaltyBps
  }
  const registry = await readCommerceObject(client, target.registryId, type(native, 'registry', 'Registry'), signal)
  const config = await readCommerceObject(client, target.configId, income.configType, signal)
  check(config.digest === income.object.digest, 'SELLER_CONFIG_CHANGED')
  const quote = quoteNativeSale(BigInt(intent.ask), { secondaryBps: income.config.secondary_bps, creatorBps: root.royaltyBps, collectionBps })
  guard()
  return { ...pair, shared: [birth(registry, false), birth(config, false), birth(policyRow, false), ...collectionRef, sharedKiosk],
    snapshot: { state: root.stateId, creator: root.creator, royalty: root.royaltyBps, config_revision: income.config.revision,
      generation: management.authorization.generation, rootRevision: root.revision, manifestHex: toHex(manifest) },
    offerDigest: null, quote }
}

export async function readNativeSellerReview(input: Request) {
  const { quote, ...state } = await readSellerState(input)
  return { identity: canonical(state), total: quote ? String(quote.total) : null,
    kioskId: state.kioskId, seller: input.intent.seller }
}

async function readGas(input: Request, coinIds: string[], budget: string) {
  const { client, signal, intent, getSellerAddress } = input
  const { response: { epoch } } = await profileReadStep(signal, () => client.ledgerService.getEpoch({
    readMask: { paths: ['epoch', 'reference_gas_price'] },
  }, { abort: signal }))
  check(typeof epoch?.epoch === 'bigint' && epoch.epoch >= 0n && typeof epoch.referenceGasPrice === 'bigint'
    && epoch.referenceGasPrice > 0n, 'SELLER_GAS_EPOCH')
  const coins = await readNativeSaleGasCoins({ client, buyer: intent.seller, total: budget, coinIds, getBuyerAddress: getSellerAddress, signal })
  return { gas: { budget, price: String(epoch.referenceGasPrice), coins }, epoch: epoch.epoch }
}

export async function prepareNativeSellerPlan(input: Request & { reviewedIdentity: string; gasCoinIds: string[]; gasBudget: string }) {
  const { quote: _, ...state } = await readSellerState(input)
  check(canonical(state) === input.reviewedIdentity, 'SELLER_REVIEW_CHANGED')
  const { gas, epoch } = await readGas(input, input.gasCoinIds, input.gasBudget)
  return { release: input.release, intent: input.intent, ...state, gas, expirationEpoch: String(epoch + 1n) } satisfies NativeSellerPlan
}

export async function recheckNativeSellerPlan(plan: NativeSellerPlan, input: Omit<Request, 'intent' | 'release'>) {
  const request = { ...input, intent: plan.intent, release: plan.release }
  const { quote: _, ...state } = await readSellerState(request)
  const { gas, epoch } = await readGas(request, plan.gas.coins.map(coin => coin.objectId), plan.gas.budget)
  const { release: _release, intent: _intent, gas: _gas, expirationEpoch, ...previous } = plan
  check(canonical(state) === canonical(previous) && canonical(gas.coins) === canonical(plan.gas.coins)
    && BigInt(plan.gas.price) >= BigInt(gas.price) && epoch <= BigInt(expirationEpoch) && BigInt(expirationEpoch) <= epoch + 1n, 'SELLER_REVIEW_OR_GAS_CHANGED')
}

export function buildNativeSellerTransaction(plan: NativeSellerPlan) {
  const { intent, release, snapshot, gas, account, kioskId } = plan
  validateIntent(intent)
  check(account.objectId === intent.accountId && uint(plan.expirationEpoch) && BigInt(plan.expirationEpoch) <= BigInt(Number.MAX_SAFE_INTEGER)
    && uint(gas.budget) && uint(gas.price) && gas.coins.length > 0 && gas.coins.length <= 256, 'SELLER_PACKET_TERMS')
  const expected = intent.kind === 'LIST' ? [release.target.registryId, release.target.configId, intent.policyId,
    ...(intent.collectionId ? [intent.collectionId] : []), kioskId] : [intent.offerId, kioskId]
  check(plan.shared.length === expected.length && plan.shared.every((row, index) => row.objectId === expected[index]
    && uint(row.initialSharedVersion) && row.mutable === (intent.kind === 'CANCEL' || row.objectId === kioskId)), 'SELLER_PACKET_SHARED')
  const ids = [...expected, intent.soulId, account.objectId, ...gas.coins.map(coin => coin.objectId)]
  check(ids.every(commerceId) && new Set(ids).size === ids.length, 'SELLER_PACKET_ALIASES')
  for (const row of [account, ...gas.coins]) {
    const digest = fromBase58(row.digest)
    check(uint(row.version) && digest.length === 32 && toBase58(digest) === row.digest, 'SELLER_PACKET_REFERENCE')
  }
  const tx = new Transaction()
  tx.setSender(intent.seller); tx.setGasOwner(intent.seller); tx.setGasBudget(gas.budget); tx.setGasPrice(gas.price)
  tx.setGasPayment(gas.coins); tx.setExpiration({ Epoch: plan.expirationEpoch })
  const args = plan.shared.map(row => tx.sharedObjectRef(row))
  args.push(tx.objectRef(account))
  const target = release.target.native.callablePackageId + '::market::'
  if (intent.kind === 'LIST') {
    check(snapshot && plan.offerDigest === null && uint(snapshot.rootRevision) && uint(snapshot.generation, false)
      && /^[0-9a-f]{64}$/.test(snapshot.manifestHex), 'SELLER_LIST_SNAPSHOT')
    tx.moveCall({ target: target + (intent.collectionId ? 'list_with_collection' : 'list'), typeArguments: [release.economics.coinType],
      arguments: [...args, tx.pure.id(intent.soulId), tx.pure.u64(intent.ask), tx.pure.u64(snapshot.rootRevision)] })
  } else {
    check(!snapshot && typeof plan.offerDigest === 'string' && fromBase58(plan.offerDigest).length === 32, 'SELLER_CANCEL_SNAPSHOT')
    tx.moveCall({ target: target + 'cancel', arguments: args })
  }
  return tx
}

export async function assertNativeSellerPacket(plan: NativeSellerPlan, packet: PublicMutationPacket) {
  const expected = await buildNativeSellerTransaction(plan).build(), bytes = fromBase64(packet.bytes)
  check(packet.expirationEpoch === plan.expirationEpoch && toBase64(expected) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'SELLER_PACKET_CHANGED')
}

export function sellerListingBinding(plan: NativeSellerPlan) {
  const { intent, snapshot, release, shared, kioskId } = plan
  check(intent.kind === 'LIST' && snapshot, 'SELLER_LIST_SNAPSHOT')
  const { state, creator, royalty, config_revision, rootRevision, manifestHex, generation } = snapshot
  return { soulId: intent.soulId, seller: intent.seller, sellerAccountId: intent.accountId, sellerKioskId: kioskId,
    registryId: release.target.registryId, configId: release.target.configId, policyId: intent.policyId, collectionId: intent.collectionId,
    coinType: release.economics.coinType, ask: intent.ask, rootRevision, shared,
    reviewSnapshot: { state, creator, royalty, config_revision, generation, manifest: fromHex(manifestHex) } }
}
