import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { assertKioskItemField, CollectionPublicListingBcs, deriveKioskItemFieldId, SoulPublicCollectionBcs,
  SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { readActivityTransactionEvidence } from '../soulidity/activity-transaction-evidence'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { historicalMoveObjectType, historicalObjectOutput, readHistoricalCreatedMoveObject, readHistoricalMoveObject } from '../sui/historical-object'
import { CollectionBuyCoinBcs, CollectionBuyLockBcs, collectionBuyLock } from './collection-buy-plan'
import { CollectionBuyPurchasedBcs } from './collection-buy-history'
import { CollectionCommandCancelledBcs } from './collection-command-history'
import { check, collectionCommandRaw, collectionCommandTypes, decode, id, parseCollectionCommandTarget, same,
  type CollectionCommandPlan, type CollectionCommandQuery } from './collection-command-plan'
import { collectionCommandChain, collectionCommandReadSet, collectionCommandSignal } from './collection-command-state'

type Argument = ReturnType<typeof bcs.Argument.parse>

/** Recover the exact app checkout funding references from its committed split
 * and optional merge. Other funding shapes need their own debit verifier. */
function funding(inputs: ReturnType<typeof bcs.CallArg.parse>[], commands: ReturnType<typeof bcs.Command.parse>[],
  payment: Argument, callIndex: number, total: bigint) {
  const splitArg = payment.NestedResult
  check(splitArg && splitArg[0] < callIndex && splitArg[1] === 0, 'SETTLEMENT_SPLIT_RESULT')
  const split = commands[splitArg[0]].SplitCoins
  check(split && split.amounts.length === 1 && commands.filter(row => row.SplitCoins).length === 1, 'SETTLEMENT_SPLIT')
  const amountIndex = split.amounts[0].Input
  const amount = amountIndex === undefined ? null : inputs[amountIndex]?.Pure
  check(amount && decode(bcs.u64(), fromBase64(amount.bytes)) === String(total), 'SETTLEMENT_SPLIT_AMOUNT')
  const merges = commands.flatMap((row, index) => row.MergeCoins ? [{ index, merge: row.MergeCoins }] : [])
  check(merges.length <= 1, 'SETTLEMENT_MERGE')
  const merge = merges[0]
  check(!merge || merge.index < splitArg[0] && same(merge.merge.destination, split.coin) && merge.merge.sources.length > 0, 'SETTLEMENT_MERGE')
  const refs = [split.coin, ...(merge?.merge.sources ?? [])].map(arg => {
    const ref = arg.Input === undefined ? null : inputs[arg.Input]?.Object?.ImmOrOwnedObject
    check(ref, 'SETTLEMENT_COIN_INPUT')
    return ref
  })
  check(refs.length <= 32 && new Set(refs.map(ref => ref.objectId)).size === refs.length, 'SETTLEMENT_PAYMENT_REFS')
  return refs
}

/** Read a closure for the Listing ID from an already verified seller command. */
export async function readCollectionListingSettlement({ client, plan, receipt, signal: parent }: {
  client: SuiGrpcClient; plan: CollectionCommandPlan; receipt: NonNullable<CollectionCommandQuery['receipt']>; signal?: AbortSignal
}) {
  const target = parseCollectionCommandTarget(plan.target), signal = collectionCommandSignal(parent)
  const { newListingId: listingId, collectionId, rightId, priceAtomic } = receipt
  check(plan.request.action !== 'delist' && listingId && listingId !== plan.oldListingId && priceAtomic
    && priceAtomic === plan.request.priceAtomic && collectionId === plan.request.collectionId && rightId === plan.rightId, 'SETTLEMENT_RECEIPT')
  const sellerAddress = plan.author, sellerKioskId = plan.kioskId
  const genesis = await collectionCommandChain(client, target, signal)
  if (target.chainIdentifier === '35834a8a') check(genesis === MAINNET_GENESIS_DIGEST, 'WRONG_MAINNET')
  const types = collectionCommandTypes(target)
  const { read, verify } = collectionCommandReadSet(client, signal)
  const row = await read(listingId)
  check(row, 'SETTLEMENT_LISTING_REQUIRED')
  const raw = collectionCommandRaw(row), move = raw.data.Move
  check(move && historicalMoveObjectType(move.type) === types.listing && raw.owner.Shared, 'SETTLEMENT_LISTING_TYPE')
  const listing = decode(CollectionPublicListingBcs, move.contents)
  check(listing.version === '1' && listing.id === listingId && listing.collection_id === collectionId && listing.right_id === rightId
    && listing.seller === sellerAddress && listing.seller_kiosk_id === sellerKioskId && listing.price === priceAtomic, 'SETTLEMENT_LISTING_IDENTITY')
  await verify()
  if (listing.is_active) {
    check(listing.purchase_cap?.kiosk_id === sellerKioskId && listing.purchase_cap.item_id === rightId
      && listing.purchase_cap.min_price === '0', 'SETTLEMENT_ACTIVE_CAP')
    return { status: 'ACTIVE' as const }
  }
  check(listing.purchase_cap === null, 'SETTLEMENT_RETIRED_CAP')

  const transactionDigest = raw.previousTransaction
  const original = await readActivityTransactionEvidence({ client, deployment: target, transactionDigest, signal })
  const effects = decode(bcs.TransactionEffects, fromBase64(original.effectsBytes)), e = effects.V2
  check(e?.status.$kind === 'Success' && e.changedObjects.length <= 512
    && new Set(e.changedObjects.map(([objectId]) => objectId)).size === e.changedObjects.length, 'SETTLEMENT_EFFECTS')
  const output = historicalObjectOutput(effects, listingId, 'mutated')
  check(output.version === BigInt(row.version) && output.digest === row.digest && same(output.owner, raw.owner), 'SETTLEMENT_LISTING_OUTPUT')
  const changes = new Map(e.changedObjects)
  const historic = { client, effects, transactionDigest, signal }
  const listingBefore = await readHistoricalMoveObject({ ...historic, objectId: listingId, type: types.listing, mode: 'input' })
  const before = decode(CollectionPublicListingBcs, listingBefore.bytes)
  check(before.is_active && before.purchase_cap && same(listingBefore.object.owner, raw.owner)
    && same({ ...before, is_active: false, purchase_cap: null }, listing)
    && before.purchase_cap.kiosk_id === sellerKioskId && before.purchase_cap.item_id === rightId
    && before.purchase_cap.min_price === '0', 'SETTLEMENT_LISTING_TRANSITION')
  const removedCap = changes.get(before.purchase_cap.id)
  check(removedCap?.idOperation.$kind === 'Deleted' && removedCap.inputState.$kind === 'NotExist'
    && removedCap.outputState.$kind === 'NotExist', 'SETTLEMENT_CAP_DELETION')

  const tx = decode(bcs.TransactionData, fromBase64(original.transactionBytes)).V1
  const ptb = tx?.kind.ProgrammableTransaction
  check(ptb && tx.sender === original.sender, 'SETTLEMENT_PTB')
  const { inputs, commands } = ptb
  const shared = (arg: Argument) => arg.Input === undefined ? undefined : inputs[arg.Input]?.Object?.SharedObject?.objectId
  const selectedEvents = original.events.filter(event => event.packageId === target.callablePackageId && event.transactionModule === 'market')
  const eventType = (name: string) => `${target.originalPackageId}::market::${name}`
  const cancels = selectedEvents.filter(event => normalizeStructTag(event.type) === eventType('CollectionListingCancelled')
    && decode(CollectionCommandCancelledBcs, fromBase64(event.contentsBytes)).listing_id === listingId)
  const buys = selectedEvents.filter(event => normalizeStructTag(event.type) === eventType('CollectionPurchased')
    && decode(CollectionBuyPurchasedBcs, fromBase64(event.contentsBytes)).listing_id === listingId)
  check(cancels.length + buys.length === 1, 'SETTLEMENT_CLOSURE_EVENT')
  const closure = { transactionDigest, checkpoint: original.checkpoint }
  if (cancels.length) {
    const cancelled = decode(CollectionCommandCancelledBcs, fromBase64(cancels[0].contentsBytes))
    check(cancelled.collection_id === collectionId && cancelled.seller === sellerAddress && original.sender === sellerAddress
      && commands.some(({ MoveCall: call }) => call?.package === target.callablePackageId && call.module === 'market'
        && call.function === 'cancel_collection_listing' && call.arguments.length === 3 && shared(call.arguments[2]) === listingId), 'SETTLEMENT_CANCELLATION')
    signal.throwIfAborted()
    return { status: 'CANCELLED' as const, ...closure }
  }

  const purchased = decode(CollectionBuyPurchasedBcs, fromBase64(buys[0].contentsBytes))
  id(purchased.buyer)
  check(purchased.collection_id === collectionId && purchased.right_id === rightId && purchased.seller === sellerAddress
    && purchased.buyer === original.sender && purchased.buyer !== sellerAddress && purchased.price === listing.price, 'SETTLEMENT_PURCHASE_EVENT')
  const buyCalls = commands.flatMap(({ MoveCall: call }, index) => call?.package === target.callablePackageId && call.module === 'market'
    && call.function === 'buy_collection_right_fixed_price_v2' ? [{ call, index }] : [])
  const buy = buyCalls[0]
  check(buyCalls.length === 1 && buy.call.arguments.length === 9, 'SETTLEMENT_PURCHASE_CALL')
  const args = buy.call.arguments
  const marketId = shared(args[0])
  check(marketId === target.marketConfigId && shared(args[1]) === target.kioskRegistryId && shared(args[3]) === collectionId
    && shared(args[4]) === sellerKioskId && shared(args[7]) === listingId, 'SETTLEMENT_PURCHASE_ARGS')

  const native = `${target.callablePackageId}::market::`
  const calls = commands.flatMap(command => {
    check(command.MoveCall || command.MergeCoins || command.SplitCoins, 'SETTLEMENT_COMMAND_KIND')
    if (!command.MoveCall) return []
    const { package: pkg, module, function: name } = command.MoveCall
    return [{ target: `${pkg}::${module}::${name}`, call: command.MoveCall }]
  })
  const guardNames = ['assert_collection_command_snapshot', 'assert_collection_listing_snapshot', 'assert_collection_market_snapshot_v2']
  const guards = new Set(guardNames.map(name => native + name))
  const prefix = calls.filter(call => guards.has(call.target))
  check(prefix.length === new Set(prefix.map(call => call.target)).size
    && prefix.every((call, index) => calls[index] === call), 'SETTLEMENT_GUARD_ORDER')
  const ensure = native + 'ensure_personal_kiosk_registered_v2', buyTarget = native + 'buy_collection_right_fixed_price_v2'
  const existingKiosk = shared(args[5])
  let allowed = [ensure, buyTarget]
  if (!existingKiosk) {
    const pkg = await readPinnedMovePackage(client, target, signal)
    const personalKiosk = pkg.linkage.get(target.personalKioskTypePackageId)?.upgradedId
    check(personalKiosk, 'SETTLEMENT_KIOSK_LINKAGE')
    const sui = normalizeSuiAddress('0x2')
    allowed = [`${sui}::kiosk::new`, `${personalKiosk}::personal_kiosk::new`, ensure, buyTarget,
      `${sui}::transfer::public_share_object`, `${personalKiosk}::personal_kiosk::transfer_to_sender`]
  }
  const business = calls.slice(prefix.length)
  check(same(business.map(call => call.target), allowed), 'SETTLEMENT_CALL_SEQUENCE')
  const registration = business[existingKiosk ? 0 : 2].call
  check(registration.typeArguments.length === 0 && same(registration.arguments, [args[0], args[1], args[6]]), 'SETTLEMENT_REGISTRATION')
  check(buy.call.typeArguments.length === 0, 'SETTLEMENT_PURCHASE_TYPE_ARGS')
  if (!existingKiosk) {
    const share = business[4].call, transfer = business[5].call
    check(share.typeArguments.length === 1 && normalizeStructTag(share.typeArguments[0]) === types.kiosk
      && same(share.arguments, [args[5]]) && transfer.typeArguments.length === 0 && same(transfer.arguments, [args[6]]), 'SETTLEMENT_NEW_KIOSK_OUTPUTS')
  }

  const marketRow = await readHistoricalMoveObject({ ...historic, objectId: marketId, type: types.market, mode: 'readonly' })
  const market = decode(SoulPublicMarketConfigBcs, marketRow.bytes)
  id(market.fee_recipient)
  check(market.id === marketId && market.version === '2' && market.secondary_enabled && market.platform_fee_bps <= 10000
    && /^0x0+$/.test(market.legacy_config_id), 'SETTLEMENT_MARKET')
  const price = BigInt(listing.price), fee = (price * BigInt(market.platform_fee_bps) + 9999n) / 10000n, total = price + fee
  check(String(fee) === purchased.platform_fee, 'SETTLEMENT_FEE')

  const [rootBefore, rootAfter] = await Promise.all((['input', 'mutated'] as const).map(mode =>
    readHistoricalMoveObject({ ...historic, objectId: collectionId, type: types.collection, mode })))
  const root = decode(SoulPublicCollectionBcs, rootBefore.bytes), next = decode(SoulPublicCollectionBcs, rootAfter.bytes)
  const buyerKioskId = next.current_holder_kiosk_id
  id(buyerKioskId)
  check(buyerKioskId !== sellerKioskId && root.id === collectionId && root.right_id === rightId && root.tradeable
    && root.current_holder === sellerAddress && root.current_holder_kiosk_id === sellerKioskId
    && same(rootBefore.object.owner, rootAfter.object.owner) && rootBefore.object.owner.Shared
    && same(next, { ...root, current_holder: purchased.buyer, current_holder_kiosk_id: buyerKioskId })
    && (existingKiosk === undefined || existingKiosk === buyerKioskId), 'SETTLEMENT_ROOT_TRANSFER')
  const sourceItem = deriveKioskItemFieldId(sellerKioskId, rightId), destination = deriveKioskItemFieldId(buyerKioskId, rightId)
  const lockId = collectionBuyLock(buyerKioskId, rightId)
  const [rightBefore, rightAfter, buyerKiosk, source, item, lock] = await Promise.all([
    readHistoricalMoveObject({ ...historic, objectId: rightId, type: types.right, mode: 'input' }),
    readHistoricalMoveObject({ ...historic, objectId: rightId, type: types.right, mode: 'mutated' }),
    readHistoricalMoveObject({ ...historic, objectId: buyerKioskId, type: types.kiosk }),
    readHistoricalMoveObject({ ...historic, objectId: sourceItem, type: types.item, mode: 'input' }),
    readHistoricalMoveObject({ ...historic, objectId: destination, type: types.item, mode: 'created' }),
    readHistoricalMoveObject({ ...historic, objectId: lockId, type: '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', mode: 'created' }),
  ])
  const delivered = decode(SoulPublicCollectionRightBcs, rightAfter.bytes), kiosk = decode(SoulPublicKioskBcs, buyerKiosk.bytes)
  const sourceRemoval = changes.get(sourceItem)
  check(rightBefore.object.owner.ObjectOwner === sourceItem && rightAfter.object.owner.ObjectOwner === destination
    && same(rightBefore.bytes, rightAfter.bytes) && delivered.id === rightId && delivered.collection_id === collectionId
    && source.object.owner.ObjectOwner === sellerKioskId && sourceRemoval?.idOperation.$kind === 'Deleted'
    && sourceRemoval.outputState.$kind === 'NotExist'
    && buyerKiosk.object.owner.Shared && kiosk.id === buyerKioskId && kiosk.owner === purchased.buyer && kiosk.item_count > 0
    && item.object.owner.ObjectOwner === buyerKioskId && lock.object.owner.ObjectOwner === buyerKioskId
    && same(decode(CollectionBuyLockBcs, lock.bytes), { id: lockId, name: { id: rightId }, value: true }), 'SETTLEMENT_RIGHT_TRANSFER')
  assertKioskItemField(source.bytes, sellerKioskId, rightId)
  assertKioskItemField(item.bytes, buyerKioskId, rightId)

  const coinType = normalizeStructTag(`0x2::coin::Coin<${target.paymentCoinType}>`)
  const refs = funding(inputs, commands, args[8], buy.index, total)
  const coinInputs = await Promise.all(refs.map(async ref => {
    const coin = await readHistoricalMoveObject({ ...historic, objectId: ref.objectId, type: coinType, mode: 'input' })
    check(coin.reference.version === BigInt(ref.version) && coin.reference.digest === ref.digest
      && coin.object.owner.AddressOwner === purchased.buyer, 'SETTLEMENT_BUYER_COIN')
    return BigInt(decode(CollectionBuyCoinBcs, coin.bytes).balance)
  }))
  const change = await readHistoricalMoveObject({ ...historic, objectId: refs[0].objectId, type: coinType, mode: 'mutated' })
  check(change.object.owner.AddressOwner === purchased.buyer && refs.slice(1).every(ref => {
    const row = changes.get(ref.objectId)
    return row?.idOperation.$kind === 'Deleted' && row.outputState.$kind === 'NotExist'
  }) && coinInputs.reduce((sum, value) => sum + value, 0n) - BigInt(decode(CollectionBuyCoinBcs, change.bytes).balance) === total, 'SETTLEMENT_BUYER_DEBIT')

  const candidates = e.changedObjects.filter(([, row]) => row.idOperation.$kind === 'Created' && row.outputState.ObjectWrite?.[1].AddressOwner)
  check(candidates.length <= 16, 'SETTLEMENT_PAYOUT_BOUND')
  const created = await Promise.all(candidates.map(([objectId]) => readHistoricalCreatedMoveObject({ ...historic, objectId })))
  const payouts = created.filter(coin => coin.type === coinType).map(coin => {
    const value = decode(CollectionBuyCoinBcs, coin.bytes), owner = coin.object.owner.AddressOwner
    check(owner, 'SETTLEMENT_PAYOUT_OWNER')
    return { id: value.id, amount: value.balance, owner }
  })
  const sellerIndex = payouts.findIndex(coin => coin.owner === sellerAddress && coin.amount === String(price))
  check(sellerIndex >= 0 && payouts.length === (fee > 0n ? 2 : 1), 'SETTLEMENT_SELLER_PAYOUT')
  const payoutCoinIds = payouts.map(coin => coin.id).sort()
  payouts.splice(sellerIndex, 1)
  const platform = payouts[0]
  check(!platform || platform.owner === market.fee_recipient && platform.amount === String(fee), 'SETTLEMENT_PLATFORM_PAYOUT')
  signal.throwIfAborted()
  return { status: 'SOLD' as const, ...closure, buyer: purchased.buyer, buyerKioskId, rightId,
    totalAtomic: String(total), seller: { owner: sellerAddress, amount: String(price) },
    platform: platform ? { owner: platform.owner, amount: platform.amount } : null, payoutCoinIds }
}
