import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { readActivityTransactionEvidence } from '../soulidity/activity-transaction-evidence'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { queryEquipmentMarketOperationEvidence } from './equipment-market-operation-evidence'
import { validateEquipmentMarketOperationRecord, type EquipmentMarketOperationRecord } from './equipment-market-operation'
import { parseEquipmentListingOriginal } from './equipment-market-listing-original'
import { queryEquipmentMarketPurchaseFunds } from './equipment-market-purchase-funds'
import { assertListingEffectsCheckpoint } from './listing-operation-evidence'
import { marketListCanonical as canonical, marketListCheck as check, marketListDigest } from './market-list-operation'
import { EquipmentMarketListingBcs } from './native-equipment-market-bcs'
import { equipmentMarketAssetCommitment } from './native-equipment-market-read'
import { EquipmentBaseItemBcs, EquipmentExternalItemBcs } from './native-equipment'
import { decodeNativeBcs } from './native-receive'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const zero = `0x${'0'.repeat(64)}`
type Listing = ReturnType<typeof EquipmentMarketListingBcs.parse>
type TransactionData = ReturnType<Transaction['getData']>
type MoveCall = NonNullable<TransactionData['commands'][number]['MoveCall']>

function immutableListing(listing: Listing) {
  const { gross_atomic: _gross, protocol_atomic: _fee, creator_atomic: _creator, source_atomic: _source,
    seller_atomic: _seller, quote_commitment: _quote, status: _status, revision: _revision, terminal_recipient: _recipient,
    ...identity } = listing
  return canonical(identity)
}

function paymentInputs(tx: TransactionData, call: MoveCall, total: string) {
  const arg = call.arguments.at(-2)
  const payment = arg?.$kind === 'NestedResult' ? arg.NestedResult : undefined
  const split = payment && tx.commands[payment[0]]?.SplitCoins
  check(payment && payment[1] === 0 && split && split.amounts.length === 1, 'Exact component payment split required')
  const amountArg = split.amounts[0]
  const amountIndex = amountArg.$kind === 'Input' ? amountArg.Input : undefined
  const amount = amountIndex === undefined ? null : tx.inputs[amountIndex]?.Pure
  check(amount && decodeNativeBcs(bcs.u64(), fromBase64(amount.bytes)) === total, 'Component payment split differs from listing total')
  const merge = tx.commands[payment[0] - 1]?.MergeCoins
  check(!merge || canonical(merge.destination) === canonical(split.coin), 'Component payment merge changed')
  const inputs = [split.coin, ...(merge?.sources ?? [])].map(arg => {
    const ref = arg.$kind === 'Input' ? tx.inputs[arg.Input]?.Object?.ImmOrOwnedObject : null
    check(ref, 'Exact component payment input required')
    return ref
  })
  check(inputs.length <= 32 && new Set(inputs.map(ref => ref.objectId)).size === inputs.length, 'Invalid component payment inputs')
  return inputs
}

/** The portable seller record identifies the original listing only. Every
 * reconstructed closing input comes from checkpoint-bound chain evidence. */
export async function queryEquipmentSellerSettlement(value: unknown, client: SuiGrpcClient, parent: AbortSignal) {
  const original = parseEquipmentListingOriginal(value), s = original.snapshot, pin = s.release.equipmentMarket!
  const signal = AbortSignal.any([parent, AbortSignal.timeout(85000)])
  const transactionDigest = original.digest
  const opened = await profileReadStep(signal, () => queryEquipmentMarketOperationEvidence(original, client))
  if (opened.status !== 'SUCCEEDED') return { status: opened.status, transactionDigest }
  await assertListingEffectsCheckpoint({ client, signal, effects: opened.effects, checkpoint: opened.checkpoint, transactionDigest })
  const { listingId } = opened.receipt
  const market = await readPinnedMovePackage(client, pin, signal)
  const origin = market.origins.get('market_v8::EquipmentListingV8')
  check(origin, 'Component listing type origin missing')
  const type = `${origin}::market_v8::EquipmentListingV8<${s.target.paymentCoinType}>`
  const anchor = await readHistoricalMoveObject({ client, signal, effects: opened.effects, transactionDigest,
    objectId: listingId, type, mode: original.action === 'list' ? 'created' : 'mutated' })
  const first = decodeNativeBcs(EquipmentMarketListingBcs, anchor.bytes)
  const birth = anchor.object.owner.Shared?.initialSharedVersion
  check(birth && first.status === 0 && first.id === listingId && first.version === '8' && first.terminal_recipient === zero
    && first.revision === opened.receipt.revision && first.gross_atomic === opened.receipt.grossAtomic
    && first.protocol_atomic === opened.receipt.protocolAtomic && first.seller_atomic === opened.receipt.sellerAtomic
    && first.creator_atomic === '0' && first.source_atomic === '0'
    && first.registry_id === s.target.registryId && first.treasury_id === s.target.treasuryId
    && first.package_config_id === s.target.packageConfigId && first.root_id === s.target.rootId
    && first.maker_version === s.quoteContext.makerVersion && toHex(Uint8Array.from(first.root_content_commitment)) === s.quoteContext.rootContentCommitment
    && first.custody.version === '8' && first.custody.catalog_id === s.target.catalogId
    && first.custody.market_registry_id === first.registry_id && first.custody.market_treasury_id === first.treasury_id
    && first.custody.root_id === first.root_id && first.custody.maker_version === first.maker_version
    && toHex(Uint8Array.from(first.custody.root_content_commitment)) === s.quoteContext.rootContentCommitment
    && first.custody.listing_id === listingId && first.custody.asset_id === s.asset.itemId
    && first.custody.asset_kind === (s.asset.kind === 'base' ? 0 : 2)
    && first.custody.source_id === (s.asset.kind === 'base' ? s.asset.baseRegistryId : s.asset.productId)
    && first.custody.holder === s.seller && first.custody.ownership_epoch === s.ownershipEpoch
    && toHex(Uint8Array.from(first.custody.asset_commitment)) === s.assetCommitment
    && toHex(Uint8Array.from(first.quote_commitment)) === opened.receipt.quoteCommitment, 'Component opening listing evidence mismatch')
  if (original.action === 'reprice') {
    const shared = Transaction.from(fromBase64(original.bytes)).getData().inputs
      .find(input => input.Object?.SharedObject?.objectId === listingId)?.Object?.SharedObject
    check(shared && String(shared.initialSharedVersion) === birth, 'Component repriced listing birth mismatch')
  }
  const summary = { transactionDigest, listingId, openingCheckpoint: opened.checkpoint }
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: listingId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'previous_transaction'] } }, { abort: signal }))
  const observed = structuredClone(response.object)
  check(observed?.objectId === listingId && observed.version !== undefined && observed.version >= anchor.reference.version
    && observed.owner?.kind === 3 && observed.owner.version === BigInt(birth)
    && marketListDigest(observed.previousTransaction), 'Current component listing reference unavailable')
  if (observed.version === anchor.reference.version) {
    check(observed.digest === anchor.reference.digest && observed.previousTransaction === transactionDigest, 'Component opening listing reference changed')
    return { status: 'OPEN' as const, ...summary, revision: first.revision }
  }
  const closingDigest = observed.previousTransaction!
  const closing = await readActivityTransactionEvidence({ client, signal, deployment: { ...pin, chainIdentifier: '35834a8a' },
    transactionDigest: closingDigest })
  const effects = decodeNativeBcs(bcs.TransactionEffects, fromBase64(closing.effectsBytes))
  const historical = { client, signal, effects, transactionDigest: closingDigest }
  const output = await readHistoricalMoveObject({ ...historical, objectId: listingId, type, mode: 'mutated' })
  const after = decodeNativeBcs(EquipmentMarketListingBcs, output.bytes)
  check(output.reference.version === observed.version && output.reference.digest === observed.digest
    && output.object.owner.Shared?.initialSharedVersion === birth && immutableListing(after) === immutableListing(first)
    && BigInt(after.revision) > BigInt(first.revision) && BigInt(closing.checkpoint) >= BigInt(opened.checkpoint), 'Component closing listing evidence mismatch')
  if (after.status === 0) {
    check(after.terminal_recipient === zero, 'Open component listing has a terminal recipient')
    return { status: 'OPEN' as const, ...summary, revision: after.revision }
  }
  check(after.status === 1 || after.status === 2 || after.status === 3, 'Unknown component listing closure')
  const prior = await readHistoricalMoveObject({ ...historical, objectId: listingId, type, mode: 'input' })
  const before = decodeNativeBcs(EquipmentMarketListingBcs, prior.bytes)
  check(prior.object.owner.Shared?.initialSharedVersion === birth && before.status === 0 && before.terminal_recipient === zero
    && BigInt(before.revision) >= BigInt(first.revision)
    && canonical({ ...before, status: after.status, revision: String(BigInt(before.revision) + 1n),
      terminal_recipient: after.terminal_recipient }) === canonical(after), 'Component listing terminal transition mismatch')

  const action = after.status === 1 ? 'buy' : after.status === 2 ? 'cancel' : 'recover'
  const tx = Transaction.from(fromBase64(closing.transactionBytes)).getData()
  const receiving = tx.inputs.find(input => input.Object?.Receiving?.objectId === s.asset.itemId)?.Object?.Receiving
  const expiry = tx.expiration?.ValidDuring?.maxEpoch ?? tx.expiration?.Epoch
  const shared = tx.inputs.find(input => input.Object?.SharedObject?.objectId === listingId)?.Object?.SharedObject
  check(receiving && expiry != null && tx.sender === closing.sender && shared && String(shared.initialSharedVersion) === birth,
    'Component closing packet inputs unavailable')
  let protocolTreasuryId = s.protocolTreasuryId
  let paymentCoins: EquipmentMarketOperationRecord['paymentCoins'] = []
  if (action === 'buy') {
    const call = tx.commands.at(-1)?.MoveCall
    check(call && call.package === pin.callablePackageId && call.module === 'market_v8'
      && call.function === `purchase_${s.asset.kind}_equipment_v8`, 'Component closing purchase call mismatch')
    const treasuryArg = call.arguments[5]
    const treasuryIndex = treasuryArg?.$kind === 'Input' ? treasuryArg.Input : undefined
    const treasury = treasuryIndex === undefined ? null : tx.inputs[treasuryIndex]?.Object?.SharedObject
    check(treasury?.mutable, 'Component purchase treasury input missing')
    protocolTreasuryId = treasury.objectId
    paymentCoins = await Promise.all(paymentInputs(tx, call, before.gross_atomic).map(async ref => {
      const coin = await readHistoricalMoveObject({ ...historical, objectId: ref.objectId,
        type: `0x2::coin::Coin<${s.target.paymentCoinType}>`, mode: 'input' })
      check(coin.reference.version === BigInt(ref.version) && coin.reference.digest === ref.digest
        && coin.object.owner.AddressOwner === closing.sender, 'Component original buyer payment reference mismatch')
      return { ...ref, version: String(ref.version), balanceAtomic: decodeNativeBcs(Coin, coin.bytes).balance }
    }))
  }
  const packet = validateEquipmentMarketOperationRecord({
    schema: 1, kind: 'equipment-market', action, phase: 'PREPARED', signature: null,
    bytes: closing.transactionBytes, digest: closingDigest, expirationEpoch: String(expiry),
    priceAtomic: before.gross_atomic, paymentCoins,
    snapshot: { ...s, actor: closing.sender, reference: receiving, protocolTreasuryId, lock: null, removal: null,
      listing: { id: listingId, revision: before.revision, priceAtomic: before.gross_atomic,
        quoteCommitment: toHex(Uint8Array.from(before.quote_commitment)) },
      available: { list: false, buy: false, reprice: false, cancel: false, recover: false } },
  })
  if (action === 'buy') {
    const sale = await queryEquipmentMarketPurchaseFunds(packet, client, signal, { proveCustody: true })
    check(sale.status === 'FUNDS_VERIFIED' && sale.checkpoint === closing.checkpoint
      && sale.receipt.listingId === listingId && sale.receipt.recipient === after.terminal_recipient, 'Component purchase closing proof mismatch')
    parent.throwIfAborted()
    return { status: 'SOLD' as const, ...summary, sale }
  }

  const returned = await profileReadStep(signal, () => queryEquipmentMarketOperationEvidence(packet, client))
  check(returned.status === 'SUCCEEDED' && returned.checkpoint === closing.checkpoint
    && canonical(returned.effects) === canonical(effects) && returned.receipt.recipient === s.seller
    && after.terminal_recipient === s.seller, 'Component return receipt mismatch')
  const runtime = await readPinnedMovePackage(client, s.release.runtime!, signal)
  const itemName = s.asset.kind === 'base' ? 'OwnedBaseItemV8' : 'OwnedExternalItemV8'
  const itemOrigin = runtime.origins.get(`runtime_v8::${itemName}`)
  check(itemOrigin, 'Component return type origin missing')
  const itemType = `${itemOrigin}::runtime_v8::${itemName}`
  const [assetBefore, assetAfter] = await Promise.all((['input', 'mutated'] as const).map(mode =>
    readHistoricalMoveObject({ ...historical, objectId: s.asset.itemId, type: itemType, mode })))
  const asset = decodeNativeBcs(s.asset.kind === 'base' ? EquipmentBaseItemBcs : EquipmentExternalItemBcs, assetAfter.bytes)
  check(assetBefore.reference.version === BigInt(receiving.version) && assetBefore.reference.digest === receiving.digest
    && assetBefore.object.owner.AddressOwner === listingId && assetAfter.object.owner.AddressOwner === s.seller
    && canonical(assetBefore.bytes) === canonical(assetAfter.bytes)
    && asset.id === s.asset.itemId && asset.version === '8' && asset.holder === s.seller
    && asset.ownership_epoch === s.ownershipEpoch && asset.equip_lock === null && asset.transferable
    && toHex(Uint8Array.from(equipmentMarketAssetCommitment(assetAfter.bytes))) === s.assetCommitment, 'Component return custody mismatch')
  parent.throwIfAborted()
  return { status: action === 'cancel' ? 'CANCELLED' as const : 'RECOVERED' as const, ...summary,
    closingDigest, closingCheckpoint: closing.checkpoint, holder: s.seller }
}
