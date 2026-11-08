import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { normalizeStructTag } from '@mysten/sui/utils'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, decodeCommerce } from './economics-read'
import { EconomicsConfigBcs, NativeOfferBcs, recoverEconomicsHistoricalGates } from './economics-bcs'
import { assertNativeSaleGraph, parseNativeSaleGraphPlan, type NativeSaleGraphPlan } from './native-sale-graph'
import { quoteNativeSale, nativeSaleDistribution } from './native-sale-quote'
import { SaleCollectionBcs, saleCollectionSnapshotHash } from './collection-sale-proof'
import { proveHistoricalSaleCollection } from './historical-sale-collection'
import { proveHistoricalSaleTransferPolicy } from './historical-sale-transfer-policy'
import { proveHistoricalSaleSourceBinding } from './historical-sale-source-binding'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })

/** Original actual-money subproof, composed only after parent finality. Exact
 * graph, original Offer/Config/optional readonly Collection and current-type
 * origins determine price/recipients. Original Coin lineage/payouts, protocol
 * ledger delta and gas are proved independently of event totals/current funds.
 * Parent still owes complete custody/source-cleanup and event/effects coverage.
 */
export async function proveNativeSaleMoney(input: { client: SuiGrpcClient; plan: NativeSaleGraphPlan;
  packet: { bytes: string; digest: string }; effects: ReturnType<typeof bcs.TransactionEffects.parse>;
  native: PinnedMovePackage; foundation: PinnedMovePackage; collection?: PinnedMovePackage;
  /** Original authenticated checkpoint, supplied by the finality parent. */
  checkpoint?: string; standard?: PinnedMovePackage; sourceBinding?: boolean; signal: AbortSignal }) {
  const p = parseNativeSaleGraphPlan(input.plan), packet = structuredClone(input.packet), effects = structuredClone(input.effects)
  const { client, signal } = input, e = effects.V2
  assertNativeSaleGraph(p, packet)
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === packet.digest && e.changedObjects.length <= 4096
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length, 'SALE_MONEY_CONTEXT')
  const native = await readPinnedMovePackage(client, input.native, signal), foundation = await readPinnedMovePackage(client, input.foundation, signal)
  const link = native.linkage.get(input.foundation.originalPackageId)
  commerceCheck(input.native.callablePackageId === p.callablePackageId && link?.upgradedId === input.foundation.callablePackageId
    && link.upgradedVersion === String(foundation.version), 'SALE_MONEY_PACKAGES')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_MONEY_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (id: string, expectedType: string, mode: 'input' | 'mutated' | 'created' | 'readonly') => readHistoricalMoveObject({
    client, effects, transactionDigest: packet.digest, objectId: id, type: expectedType, mode, signal })
  const offerObject = await read(p.offerId, type(native.origins, 'market', 'Offer'), 'input'), o = decodeCommerce(NativeOfferBcs, offerObject.bytes)
  const assertSharedBirth = (id: string, object: Awaited<ReturnType<typeof read>>) => {
    const ref = p.shared.find(row => row.objectId === id)
    commerceCheck(ref && object.object.owner.Shared?.initialSharedVersion === ref.initialSharedVersion, 'SALE_MONEY_SHARED_REFERENCE')
  }
  assertSharedBirth(p.offerId, offerObject)
  commerceCheck(offerObject.object.owner.$kind === 'Shared' && o.id === p.offerId && o.active && o.purchase && o.root === p.soulId
    && o.registry === p.registryId && o.config === p.configId && o.policy === p.policyId && o.kiosk === p.sellerKioskId
    && o.generation === p.generation && o.collection === p.collectionId && o.seller !== p.buyer, 'SALE_MONEY_OFFER')
  const configType = `${type(foundation.origins, 'economics', 'Config')}<${p.coinType}>`
  const configInput = await read(p.configId, configType, 'input'), configOutput = await read(p.configId, configType, 'mutated')
  const before = decodeCommerce(EconomicsConfigBcs, configInput.bytes), after = decodeCommerce(EconomicsConfigBcs, configOutput.bytes)
  assertSharedBirth(p.configId, configInput); assertSharedBirth(p.configId, configOutput)
  const gates = recoverEconomicsHistoricalGates(before)
  commerceCheck(configInput.object.owner.$kind === 'Shared' && configOutput.object.owner.$kind === 'Shared'
    && before.id === p.configId && before.revision === o.config_revision && before.income.root === p.configId
    && before.schema === 3 && BigInt(before.minimum_release) <= 2n
    && before.original_package === input.foundation.originalPackageId && before.callable_package === input.foundation.callablePackageId
    && normalizeStructTag(before.payment_coin.name) === p.coinType
    && gates.gates.secondary && before.enabled && !before.paused, 'SALE_MONEY_ORIGINAL_POLICY')
  const role = before.roles.roles[3], marker = role?.marker && normalizeStructTag(role.marker.name), parts = marker?.split('::')
  commerceCheck(before.roles.roles.length === 6 && role?.pinned && role.original === native.pin.originalPackageId
    && role.callable === native.pin.callablePackageId && role.version === String(native.version)
    && native.origins.get('market::MarketAuthority1') === native.pin.originalPackageId
    && parts?.length === 3 && parts[0] === native.pin.callablePackageId && parts[1] === 'market'
    && /^MarketRevision[1-9][0-9]*$/.test(parts[2]) && native.origins.get(`market::${parts[2]}`) === native.pin.callablePackageId,
    'SALE_MONEY_MARKET_ROLE')
  let collectionBps = 0, collectionHolder = o.seller, collectionSnapshot: Uint8Array | null = null
  let collectionMembership: Awaited<ReturnType<typeof proveHistoricalSaleCollection>> | null = null
  if (p.collectionId) {
    commerceCheck(input.collection, 'SALE_MONEY_COLLECTION_PIN')
    const pkg = await readPinnedMovePackage(client, input.collection, signal), dependency = native.linkage.get(input.collection.originalPackageId)
    commerceCheck(dependency?.upgradedId === input.collection.callablePackageId && dependency.upgradedVersion === String(pkg.version), 'SALE_MONEY_COLLECTION_LINK')
    const original = await read(p.collectionId, type(pkg.origins, 'collection', 'Collection'), 'readonly'), c = decodeCommerce(SaleCollectionBcs, original.bytes)
    commerceCheck(c.id === p.collectionId && c.protocol === p.configId && c.schema_version === 1 && c.creator === o.creator, 'SALE_MONEY_ORIGINAL_COLLECTION')
    collectionBps = c.extra; collectionHolder = c.holder; collectionSnapshot = saleCollectionSnapshotHash(c)
    if (input.checkpoint !== undefined) {
      collectionMembership = await proveHistoricalSaleCollection({ client, effects, packet, transactionDigest: packet.digest,
        checkpoint: input.checkpoint, pin: input.collection, nativeLinkage: native.linkage,
        collectionId: p.collectionId, configId: p.configId, soulId: p.soulId, signal })
      commerceCheck(collectionMembership.holder === collectionHolder && collectionMembership.royaltyBps === collectionBps,
        'SALE_MONEY_COLLECTION_MEMBERSHIP_SNAPSHOT')
    }
  }
  const quote = quoteNativeSale(BigInt(o.ask), { secondaryBps: before.secondary_bps, creatorBps: o.royalty, collectionBps })
  const transferPolicy = input.standard && input.checkpoint !== undefined ? await proveHistoricalSaleTransferPolicy({ client, effects,
    packet, transactionDigest: packet.digest, checkpoint: input.checkpoint, policyId: p.policyId, configId: p.configId,
    coinType: p.coinType, native: input.native, standard: input.standard, signal }) : null
  commerceCheck(!transferPolicy || transferPolicy.additionalRules.length === 0, 'SALE_MONEY_UNSUPPORTED_TRANSFER_RULES')
  commerceCheck(!input.sourceBinding || input.checkpoint !== undefined, 'SALE_MONEY_SOURCE_CHECKPOINT_REQUIRED')
  const sourceBinding = input.sourceBinding ? await proveHistoricalSaleSourceBinding({ client, plan: p, packet, effects,
    checkpoint: input.checkpoint!, native: input.native, foundation: input.foundation, standard: input.standard, signal }) : null
  const reciprocalCollection = p.collectionId && collectionMembership && sourceBinding?.soulBinding
    && sourceBinding.nativeCollectionBinding?.collectionId === p.collectionId
    && collectionMembership.collectionId === p.collectionId && collectionMembership.soulId === p.soulId
    ? { proof: 'original-native-collection-reciprocal-binding-only' as const, collectionId: p.collectionId, soulId: p.soulId,
      stateId: sourceBinding.stateId, nativeFieldId: sourceBinding.nativeCollectionBinding.fieldId,
      memberFieldId: collectionMembership.member.objectId, creator: collectionMembership.creator, notCurrentAuthority: true as const } : null
  commerceCheck(String(quote.total) === p.reviewedTotal, 'SALE_MONEY_REVIEWED_PRICE')
  const distribution = nativeSaleDistribution(quote, { seller: o.seller, creator: o.creator, collection: collectionHolder })
  let originalBalance = 0n
  for (const [index, ref] of p.paymentCoins.entries()) {
    const original = await read(ref.objectId, `0x2::coin::Coin<${p.coinType}>`, 'input'), coin = decodeCommerce(Coin, original.bytes)
    commerceCheck(original.reference.version === BigInt(ref.version) && original.reference.digest === ref.digest
      && original.object.owner.AddressOwner === p.buyer && coin.id === ref.objectId && coin.balance === ref.balance, 'SALE_MONEY_INPUT_COIN')
    originalBalance += BigInt(coin.balance)
    if (index > 0) { const change = e.changedObjects.find(([id]) => id === ref.objectId)![1]
      commerceCheck(change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist', 'SALE_MONEY_MERGED_COIN') }
  }
  const base = await read(p.paymentCoins[0].objectId, `0x2::coin::Coin<${p.coinType}>`, 'mutated'), change = decodeCommerce(Coin, base.bytes)
  commerceCheck(base.object.owner.AddressOwner === p.buyer && change.id === p.paymentCoins[0].objectId
    && originalBalance - BigInt(change.balance) === quote.total, 'SALE_MONEY_BUYER_DEBIT')
  commerceCheck(before.income.root === after.income.root && before.income.withdrawn === after.income.withdrawn
    && BigInt(before.income.collected) - BigInt(before.income.withdrawn) === BigInt(before.income.funds)
    && BigInt(after.income.collected) - BigInt(after.income.withdrawn) === BigInt(after.income.funds)
    && BigInt(after.income.funds) - BigInt(before.income.funds) === quote.platform
    && BigInt(after.income.collected) - BigInt(before.income.collected) === quote.platform
    && BigInt(after.income.revision) - BigInt(before.income.revision) === (quote.platform > 0n ? 1n : 0n)
    && publicMutationCanonical(before.income.requests) === publicMutationCanonical(after.income.requests)
    && publicMutationCanonical({ ...before, income: null }) === publicMutationCanonical({ ...after, income: null }), 'SALE_MONEY_PROTOCOL_INCOME')
  const slots = [{ owner: o.seller, amount: distribution.sellerTransfer },
    ...(distribution.creatorTransfer > 0n ? [{ owner: o.creator, amount: distribution.creatorTransfer }] : []),
    ...(distribution.collectionTransfer > 0n ? [{ owner: collectionHolder, amount: distribution.collectionTransfer }] : [])]
  const created = e.changedObjects.filter(([, row]) => row.idOperation.$kind === 'Created' && row.outputState.ObjectWrite?.[1].AddressOwner)
  commerceCheck(created.length === slots.length && e.changedObjects.every(([, row]) => !row.outputState.AccumulatorWriteV1), 'SALE_MONEY_PAYOUT_COUNT_OR_UNPROVED_ACCUMULATOR')
  const payouts: Array<{ coinId: string; owner: string; amount: string }> = []
  for (const [id] of created) { const output = await read(id, `0x2::coin::Coin<${p.coinType}>`, 'created'), coin = decodeCommerce(Coin, output.bytes)
    commerceCheck(coin.id === id && output.object.owner.AddressOwner, 'SALE_MONEY_PAYOUT_COIN')
    payouts.push({ coinId: id, owner: output.object.owner.AddressOwner, amount: coin.balance }) }
  const amounts = (rows: Array<{ owner: string; amount: string | bigint }>) => rows.map(row => `${row.owner}:${String(row.amount)}`).sort()
  commerceCheck(publicMutationCanonical(amounts(payouts)) === publicMutationCanonical(amounts(slots)), 'SALE_MONEY_PAYOUT_DISTRIBUTION')
  const gas = await readSuiGasSettlement({ client, packet, effects, signal })
  const buyerIncomingPayout = payouts.filter(coin => coin.owner === p.buyer).reduce((sum, coin) => sum + BigInt(coin.amount), 0n)
  return { proof: 'native-sale-original-coins-ledger-payout-gas-only' as const, transactionDigest: packet.digest, quote,
    coinType: p.coinType, buyer: p.buyer, buyerGrossDebit: String(quote.total), buyerIncomingPayout: String(buyerIncomingPayout),
    buyerNetBusinessDebit: String(quote.total - buyerIncomingPayout),
    buyerInput: String(originalBalance), buyerChange: change.balance, payouts, protocolIncome: String(quote.platform), gas,
    collectionHolder, collectionSnapshot, collectionMembership, reciprocalCollection, transferPolicy, sourceBinding,
    requiresOriginalReciprocalCollectionProof: p.collectionId !== null && reciprocalCollection === null,
    requiresOriginalSourceBindingProof: sourceBinding === null,
    requiresOriginalTransferPolicyProof: transferPolicy === null,
    requiresOriginalCollectionMembershipProof: p.collectionId !== null && collectionMembership === null,
    creator: o.creator, seller: o.seller,
    claimedEffectIds: [p.configId, ...p.paymentCoins.map(c => c.objectId), ...payouts.map(c => c.coinId), ...gas.gasCoinIds],
    notCompleteSaleProof: true as const, notCurrentBalances: true as const }
}
