import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { readHistoricalCreatedMoveObject, readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { withPackageObjectIdentity } from '../sui/package-object-client'
import { readSuiGasSettlement } from '../sui/gas-settlement'
import { marketBuyCheck as check, validateMarketBuyOperationRecord, type MarketBuyOperationRecord } from './market-buy-operation'
import { queryMarketBuyOperationEvidence } from './market-buy-operation-adapter'
import { NativeMarketConfigBcs, NativeMarketListingBcs } from './native-market'
import { NativeCancelKioskBcs, NativeCancelPersonalKioskCapBcs } from './native-market-cancel-snapshot'
import { decodeNativeBcs } from './native-receive'
import { createMarketBuyFundsOriginal } from './market-buy-funds-original'
import { assertListingEffectsCheckpoint } from './listing-operation-evidence'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const KIOSK_FAMILY = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
const ZERO = '0x' + '0'.repeat(64)
type PayoutRole = 'seller' | 'soulCreator' | 'makerSource' | 'service'
type Payout = { owner: string; amount: string; roles: PayoutRole[]; coinIds: string[] }

export async function assertMarketBuyEffectsCheckpoint(input: {
  client: SuiGrpcClient
  effects: ReturnType<typeof bcs.TransactionEffects.parse>
  checkpoint: string
  transactionDigest: string
  signal: AbortSignal
}) {
  return assertListingEffectsCheckpoint(input, 'Native purchase effects missing from original checkpoint')
}
export type MarketBuyCheckpointProof = Awaited<ReturnType<typeof assertMarketBuyEffectsCheckpoint>>

/** Original USDC object settlement and separate SUI gas for a saved native V8 buy. */
export async function queryMarketBuyPurchaseFunds(value: MarketBuyOperationRecord, source: SuiGrpcClient, parent: AbortSignal) {
  const record = validateMarketBuyOperationRecord(value), transactionDigest = record.digest
  const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)])
  const client = withPackageObjectIdentity(source, signal)
  const original = await profileReadStep(signal, () => queryMarketBuyOperationEvidence(record, client))
  if (original.status !== 'SUCCEEDED') return { status: original.status, transactionDigest }
  const { effects, checkpoint, receipt } = original
  const e = effects.V2
  if (!e) return { status: 'LEGACY_EFFECTS' as const, transactionDigest, checkpoint }

  const checkpointProof = original.checkpointProof ?? await assertMarketBuyEffectsCheckpoint({ client, effects, checkpoint, transactionDigest, signal })
  const gasAccumulatorIds = new Set(original.addressGas?.accumulatorIds ?? [])
  const changes = new Map(e.changedObjects)
  check(changes.size === e.changedObjects.length && changes.size <= 4096
    && e.changedObjects.every(([id, row]) => !row.outputState.AccumulatorWriteV1 || gasAccumulatorIds.has(id)), 'Unexpected native purchase money effects')

  const { snapshot: s, paymentCoins } = record, release = s.release
  const native = await readPinnedMovePackage(client, { originalPackageId: release.soulidityOriginalPackageId,
    callablePackageId: release.soulidityCallablePackageId, callableDigest: release.soulidityCallableDigest }, signal)
  const read = (objectId: string, type: string, mode: 'input' | 'mutated' | 'readonly' | 'created') =>
    readHistoricalMoveObject({ client, effects, transactionDigest, objectId, type, mode, signal, maxBytes: 1024 })
  function marketType(name: string) {
    check(native.origins.get(`market::${name}`) === release.soulidityOriginalPackageId, 'Original market type origin mismatch')
    return `${release.soulidityOriginalPackageId}::market::${name}`
  }
  const tx = Transaction.from(fromBase64(record.bytes)).getData()
  function sharedBirth(id: string) {
    return tx.inputs.find(input => input.Object?.SharedObject?.objectId === id)?.Object?.SharedObject?.initialSharedVersion
  }
  const [originalConfig, originalListing] = await Promise.all([
    read(release.marketConfigV2Id, marketType('MarketConfigV2'), 'readonly'),
    read(s.listingId, marketType('SoulListing'), 'input'),
  ])
  const config = decodeNativeBcs(NativeMarketConfigBcs, originalConfig.bytes)
  const listing = decodeNativeBcs(NativeMarketListingBcs, originalListing.bytes)
  check(originalConfig.object.owner.Shared?.initialSharedVersion === sharedBirth(release.marketConfigV2Id)
    && config.id === release.marketConfigV2Id && config.version === '2' && config.legacy_config_id === ZERO
    && config.secondary_enabled && config.platform_fee_bps === 250 && config.fee_recipient === s.protocolFeeRecipient,
  'Original service fee configuration mismatch')
  check(originalListing.object.owner.Shared?.initialSharedVersion === sharedBirth(s.listingId)
    && listing.id === s.listingId && listing.version === '8' && listing.is_active && listing.collection_id === null
    && listing.soul_id === s.soulId && listing.state_id === s.stateId && listing.seller === s.seller
    && listing.seller_kiosk_id === s.sellerKioskId && listing.price === receipt.price && listing.creator === s.creator
    && listing.creator_royalty_bps === receipt.soul_creator_royalty_bps
    && listing.purchase_cap?.kiosk_id === s.sellerKioskId && listing.purchase_cap.item_id === s.soulId
    && listing.purchase_cap.min_price === '0', 'Original seller and creator listing mismatch')

  const coinType = release.paymentCoinType, paymentType = normalizeStructTag(`0x2::coin::Coin<${coinType}>`)
  let inputBalance = 0n
  for (const [index, ref] of paymentCoins.entries()) {
    const before = await read(ref.objectId, paymentType, 'input')
    const coin = decodeNativeBcs(Coin, before.bytes)
    check(before.reference.version === BigInt(ref.version) && before.reference.digest === ref.digest
      && before.object.owner.AddressOwner === s.buyer && coin.id === ref.objectId && coin.balance === ref.balanceAtomic,
    'Original buyer payment Coin mismatch')
    inputBalance += BigInt(coin.balance)
    if (index > 0) {
      const consumed = changes.get(ref.objectId)
      check(consumed?.idOperation.$kind === 'Deleted' && consumed.outputState.$kind === 'NotExist', 'Merged payment Coin survived')
    }
  }
  const primary = paymentCoins[0].objectId, change = await read(primary, paymentType, 'mutated')
  const changeCoin = decodeNativeBcs(Coin, change.bytes), gross = BigInt(receipt.price)
  check(change.object.owner.AddressOwner === s.buyer && changeCoin.id === primary
    && inputBalance - BigInt(changeCoin.balance) === gross, 'Original buyer USDC debit mismatch')

  const shares: Array<{ role: PayoutRole; owner: string; amount: string }> = [
    { role: 'seller', owner: listing.seller, amount: receipt.seller_payout },
    { role: 'soulCreator', owner: listing.creator, amount: receipt.soul_creator_royalty },
    { role: 'makerSource', owner: receipt.maker_source_recipient, amount: receipt.maker_source_royalty },
    { role: 'service', owner: config.fee_recipient, amount: receipt.protocol_fee },
  ]
  check(shares.reduce((total, share) => total + BigInt(share.amount), 0n) === gross, 'Original USDC quote does not conserve payment')
  const groups = new Map<string, Payout>()
  const payoutKey = (owner: string, amount: string) => `${owner}:${amount}`
  for (const share of shares) {
    if (share.amount === '0') continue
    const key = payoutKey(share.owner, share.amount)
    const group = groups.get(key) ?? { owner: share.owner, amount: share.amount, roles: [], coinIds: [] }
    group.roles.push(share.role)
    groups.set(key, group)
  }
  const outputs = e.changedObjects.filter(([, row]) => row.idOperation.$kind === 'Created' && row.outputState.ObjectWrite?.[1].AddressOwner)
  const createsKiosk = s.buyerKioskId === null
  check(outputs.length === shares.filter(share => share.amount !== '0').length + Number(createsKiosk), 'Unexpected original address-owned outputs')
  let capType: string | null = null
  if (createsKiosk) {
    const link = native.linkage.get(KIOSK_FAMILY)
    check(link?.upgradedId === release.kioskPackageId, 'Original Personal Kiosk package linkage mismatch')
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: link.upgradedId,
      readMask: { paths: ['object_id', 'digest'] } }, { abort: signal }))
    check(response.object?.objectId === link.upgradedId && response.object.digest, 'Original Kiosk package pin unavailable')
    const kiosk = await readPinnedMovePackage(client, { originalPackageId: KIOSK_FAMILY,
      callablePackageId: link.upgradedId, callableDigest: response.object.digest }, signal)
    const origin = kiosk.origins.get('personal_kiosk::PersonalKioskCap')
    check(String(kiosk.version) === link.upgradedVersion && origin, 'Original Personal Kiosk cap type unavailable')
    capType = `${origin}::personal_kiosk::PersonalKioskCap`
  }
  let newCap = false
  for (const [objectId] of outputs) {
    const row = await readHistoricalCreatedMoveObject({ client, effects, transactionDigest, objectId, signal, maxBytes: 1024 })
    const owner = row.object.owner.AddressOwner
    check(owner, 'Original address-owned output mismatch')
    if (row.type === paymentType) {
      const coin = decodeNativeBcs(Coin, row.bytes), group = groups.get(payoutKey(owner, coin.balance))
      check(coin.id === objectId && group && group.coinIds.length < group.roles.length, 'Original USDC payout recipient or amount mismatch')
      group.coinIds.push(objectId)
      continue
    }
    check(capType && row.type === capType && !newCap && owner === s.buyer, 'Unrecognized original address-owned output')
    const cap = decodeNativeBcs(NativeCancelPersonalKioskCapBcs, row.bytes)
    check(cap.id === objectId && cap.cap, 'Original buyer Kiosk cap output mismatch')
    const kiosk = await read(cap.cap.for, '0x2::kiosk::Kiosk', 'created')
    const kioskValue = decodeNativeBcs(NativeCancelKioskBcs, kiosk.bytes)
    check(kiosk.object.owner.Shared && kioskValue.id === cap.cap.for && kioskValue.owner === s.buyer,
      'Original new buyer Kiosk output mismatch')
    newCap = true
  }
  const payouts = [...groups.values()]
  check(newCap === createsKiosk && payouts.every(group => group.coinIds.length === group.roles.length),
    'Original payout object count mismatch')

  let gas: typeof original.addressGas | Awaited<ReturnType<typeof readSuiGasSettlement>> | null = original.addressGas ?? null
  if (!gas) {
    try { gas = await readSuiGasSettlement({ client, packet: record, effects, signal }) }
    catch { signal.throwIfAborted() }
  }
  signal.throwIfAborted()
  return { status: 'VERIFIED' as const, transactionDigest, checkpoint, checkpointProof, coinType, buyerDebit: receipt.price,
    buyerChangeCoinId: primary, shares, payouts, gas, portableOriginal: createMarketBuyFundsOriginal(record) }
}

export type MarketBuyPurchaseFunds = Awaited<ReturnType<typeof queryMarketBuyPurchaseFunds>>
