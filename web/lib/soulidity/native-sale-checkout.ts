import { canRetireNativeSaleOriginal, retiredNativeSaleResult, verifyNativeSaleRetirement } from './commerce/native-sale-original-retirement'
import { simulateNativeSalePacket } from './commerce/native-sale-simulation'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { captureAccountOriginalReadClientV155 } from './management/account-original-readers-v155'
import { captureSameSoulMarketExecutionClient, captureSameSoulMutationClient } from './same-soul-mutation-client'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from './same-soul-mutation-heads'
import { withSoulAccessAssetLock, type SoulAccessAssetScope } from './soul-access-asset-lock'
import { commerceCheck as check, commerceId, decodeCommerce, readCommerceObject } from './commerce/economics-read'
import { nativeSaleQuoteIdentity, readNativeOfferPreview } from './commerce/native-offer-read'
import { readNativeSaleFunding } from './commerce/native-sale-funding'
import { prepareNativeSalePurchase, recheckNativeSalePurchase } from './commerce/native-sale-preparation'
import { parsePurchaseRecoveryOriginal } from './commerce/purchase-recovery-original'
import { nativeSaleCheckoutInstalled, type NativeSaleCheckoutRelease } from './native-sale-checkout-config'
import { browserNativeSaleCheckoutJournal, nativeSaleCheckoutKey, nativeSaleCheckoutMatches, parseNativeSaleCheckoutRecord,
  queryNativeSaleCheckoutRecord, type NativeSaleCheckoutRecord } from './native-sale-checkout-journal'

type WalletLease = { getBuyerAddress: () => string | null; signal: AbortSignal }
const previewInputs = (release: NativeSaleCheckoutRelease) => ({ native: release.target.native, registryId: release.target.registryId,
  economics: release.economics, collection: release.collection ?? undefined })

export async function reviewNativeSaleCheckout(input: { client: SuiGrpcClient; release: NativeSaleCheckoutRelease; soulId: string; offerId: string; signal: AbortSignal }) {
  const { soulId, offerId, signal } = input, release = structuredClone(input.release)
  check(nativeSaleCheckoutInstalled(release) && commerceId(soulId) && commerceId(offerId), 'SALE_CHECKOUT_RELEASE')
  const preview = await readNativeOfferPreview({ ...previewInputs(release), offerId, client: input.client, signal })
  check(preview.offer.root === soulId && preview.offer.id === offerId && preview.quote && preview.blockers.length === 0, 'SALE_CHECKOUT_OFFER')
  return { soulId, offerId, seller: preview.offer.seller, creator: preview.offer.creator, collectionHolder: preview.collection?.holder ?? null,
    coinType: preview.economics.coinType, total: String(preview.quote.total),
    ask: String(preview.quote.ask), platform: String(preview.quote.platform), creatorRoyalty: String(preview.quote.creator),
    collectionRoyalty: String(preview.quote.collection), quoteIdentity: nativeSaleQuoteIdentity(preview) }
}


function lockSale<T>(scope: SoulAccessAssetScope, work: (key: string, journal: ReturnType<typeof browserNativeSaleCheckoutJournal>) => Promise<T>) {
  const key = nativeSaleCheckoutKey(scope), journal = browserNativeSaleCheckoutJournal()
  return withSoulAccessAssetLock(scope, () => journal.exclusive(key, () => work(key, journal)))
}

function walletGuard(lease: WalletLease, buyer: string, release: NativeSaleCheckoutRelease) {
  lease.signal.throwIfAborted()
  check(lease.getBuyerAddress() === buyer && nativeSaleCheckoutInstalled(release), 'SALE_CHECKOUT_WALLET_OR_SOURCE_CHANGED')
}

export function prepareNativeSaleCheckout(input: WalletLease & {
  client: SuiGrpcClient; release: NativeSaleCheckoutRelease; review: Awaited<ReturnType<typeof reviewNativeSaleCheckout>>;
  buyer: string; buyerAccountId: string; paymentCoinIds: string[]; gasCoinIds: string[]; gasBudget: string
}) {
  const { client: source, signal: parent, getBuyerAddress, ...values } = input
  const request = structuredClone(values), { buyer, review, release, buyerAccountId, paymentCoinIds, gasCoinIds, gasBudget } = request
  const signal = AbortSignal.any([parent, AbortSignal.timeout(90000)]), client = captureSameSoulMutationClient(source, signal)
  const scope = { chainIdentifier: release.target.chainIdentifier, soulId: review.soulId, author: buyer }
  const guard = () => walletGuard({ signal, getBuyerAddress }, buyer, release)
  return lockSale(scope, async (key, journal) => {
    guard()
    const previous = await journal.read(key)
    if (previous) {
      const observed = await queryNativeSaleCheckoutRecord(previous, client, signal)
      if (!((previous.packet.phase === 'FAILED' && observed.status === 'FAILED')
        || (previous.packet.phase === 'SUCCEEDED' && observed.status === 'SUCCEEDED')
        || (previous.packet.phase === 'CANCELLED' && observed.status === 'MISSING')
        || (previous.packet.phase === 'RETIRED' && observed.status === 'RETIRED'))) return { record: previous, prepared: false }
    }
    const heads = createBrowserSameSoulHeadPort(client, undefined, signal)
    await assertSameSoulForeignHeads({ scopes: [scope], ownKeys: [key], signal, port: heads }); guard()
    const info = await client.ledgerService.getServiceInfo({}, { abort: signal })
    check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'SALE_CHECKOUT_CHAIN')
    const { response: { epoch } } = await profileReadStep(signal, () => client.ledgerService.getEpoch({
      readMask: { paths: ['epoch', 'reference_gas_price'] },
    }, { abort: signal }))
    check(typeof epoch?.epoch === 'bigint' && typeof epoch.referenceGasPrice === 'bigint' && epoch.referenceGasPrice > 0n, 'SALE_CHECKOUT_EPOCH')
    const gas = await readNativeSaleFunding({ client, buyer, coinType: '0x2::sui::SUI', total: gasBudget,
      coinIds: gasCoinIds, gasCoinIds: paymentCoinIds, getBuyerAddress, signal })
    const clock = await readSaleClock(client, signal)
    const original = await prepareNativeSalePurchase({ client, signal, getBuyerAddress, target: release.target, economics: release.economics,
      collection: release.collection ?? undefined, offerId: review.offerId, buyer, buyerAccountId, paymentCoinIds,
      gas: { budget: gasBudget, price: String(epoch.referenceGasPrice), coins: gas.coins.map(({ objectId, version, digest }) => ({ objectId, version, digest })) },
      expirationEpoch: String(epoch.epoch + 1n), quoteExpiryMs: String(clock + 120000n),
      attemptHex: toHex(crypto.getRandomValues(new Uint8Array(32))), reviewedSoulId: scope.soulId,
      reviewedTotal: review.total, reviewedQuoteIdentity: review.quoteIdentity })
    const record = await parseNativeSaleCheckoutRecord({ schema: 'soulidity.native-sale-checkout.v1',
      plan: { ...scope, originalText: JSON.stringify(original), reviewedQuoteIdentity: review.quoteIdentity }, packet: original.packet })
    check(previous?.packet.digest !== record.packet.digest, 'SALE_CHECKOUT_PREVIOUS_PACKET_REUSE')
    check(canonical(await journal.read(key)) === canonical(previous), 'SALE_CHECKOUT_HEAD_CHANGED')
    guard()
    await journal.write(key, record)
    check(nativeSaleCheckoutMatches(await journal.read(key), record), 'SALE_CHECKOUT_PERSISTENCE')
    guard()
    await simulateNativeSalePacket(client, record.packet, signal)
    guard()
    return { record, prepared: true }
  })
}

export function recoverNativeSaleCheckout(input: {
  record: NativeSaleCheckoutRecord; client: SuiGrpcClient; signal: AbortSignal; cancelUnsigned?: true; retireExpired?: true
}) {
  const record = structuredClone(input.record), signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)])
  const client = captureSameSoulMutationClient(input.client, signal)
  return lockSale(record.plan, async (key, journal) => {
    check(nativeSaleCheckoutMatches(await journal.read(key), record), 'SALE_CHECKOUT_HEAD_CHANGED')
    const { cancelUnsigned, retireExpired } = input
    check(!cancelUnsigned || !retireExpired, 'SALE_CHECKOUT_RECOVERY_MODE')
    if (retireExpired) check(canRetireNativeSaleOriginal(record.packet), 'SALE_CHECKOUT_RETIRE_PHASE')
    if (cancelUnsigned) check(record.packet.phase === 'PREPARED' && record.packet.signature === null, 'SALE_CHECKOUT_CANCEL_PREPARED_ONLY')
    const result = await queryNativeSaleCheckoutRecord(record, client, signal)
    signal.throwIfAborted()
    if (cancelUnsigned) check(result.status === 'MISSING', 'SALE_CHECKOUT_CANCEL_ORIGINAL_FOUND')
    check(!['SUCCEEDED', 'FAILED'].includes(record.packet.phase) || record.packet.phase === result.status, 'SALE_CHECKOUT_TERMINAL_CONTRADICTION')
    const retirement = retireExpired && result.status === 'MISSING' ? await verifyNativeSaleRetirement({
      client, signal, packet: record.packet, author: record.plan.author, queryOriginal: () => queryNativeSaleCheckoutRecord(record, client, signal),
    }) : undefined
    const phase = retirement ? 'RETIRED' : cancelUnsigned ? 'CANCELLED'
      : result.status === 'SUCCEEDED' || result.status === 'FAILED' ? result.status : record.packet.phase
    if (phase === record.packet.phase) return { record, result }
    check(nativeSaleCheckoutMatches(await journal.read(key), record), 'SALE_CHECKOUT_HEAD_CHANGED')
    signal.throwIfAborted()
    const updated = { ...record, ...(retirement ? { retirement } : {}), packet: { ...record.packet, phase } }
    await journal.write(key, updated)
    check(nativeSaleCheckoutMatches(await journal.read(key), updated), 'SALE_CHECKOUT_PERSISTENCE')
    return { record: updated, result: retirement ? retiredNativeSaleResult(record.packet.digest) : result }
  })
}

export function executeNativeSaleCheckout(input: WalletLease & {
  record: NativeSaleCheckoutRecord; client: SuiGrpcClient; activeOfferId: string; activeRelease: NativeSaleCheckoutRelease;
  sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
}) {
  const { client: source, getBuyerAddress, sign, activeOfferId } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180000)])
  const client = captureSameSoulMarketExecutionClient(source, signal), signatureClient = captureAccountOriginalReadClientV155(source)
  const expected = structuredClone(input.record), scope = expected.plan, activeRelease = structuredClone(input.activeRelease)
  return lockSale(scope, async (key, journal) => {
    let record = await parseNativeSaleCheckoutRecord(expected)
    const parsed = await parsePurchaseRecoveryOriginal(record.plan.originalText, scope.soulId)
    check(parsed.kind === 'native-sale-preparation.v1', 'SALE_CHECKOUT_ORIGINAL_FORMAT')
    const { plan, context: { target, economics, collection } } = parsed.value
    const release = { target, economics, collection }
    const guard = () => walletGuard({ signal, getBuyerAddress }, plan.buyer, release)
    const sameHead = async () => check(nativeSaleCheckoutMatches(await journal.read(key), record), 'SALE_CHECKOUT_HEAD_CHANGED')
    async function save(phase: PublicMutationPacket['phase'], signature = record.packet.signature) {
      await sameHead()
      if (phase === 'SIGNING') guard()
      const next = { ...record, packet: { ...record.packet, phase, signature } }
      await journal.write(key, next)
      check(nativeSaleCheckoutMatches(await journal.read(key), next), 'SALE_CHECKOUT_PERSISTENCE')
      record = next
    }
    async function query() {
      const result = await queryNativeSaleCheckoutRecord(record, client, signal)
      signal.throwIfAborted()
      check(!['SUCCEEDED', 'FAILED'].includes(record.packet.phase) || record.packet.phase === result.status, 'SALE_CHECKOUT_TERMINAL_CONTRADICTION')
      if ((result.status === 'SUCCEEDED' || result.status === 'FAILED') && result.status !== record.packet.phase) await save(result.status)
      return result
    }
    async function preflight() {
      guard()
      await recheckNativeSalePurchase({ client, signal, target, economics, collection: collection ?? undefined,
        offerId: plan.offerId, buyer: plan.buyer, buyerAccountId: plan.buyerAccount.objectId, getBuyerAddress,
        reviewedQuoteIdentity: record.plan.reviewedQuoteIdentity, plan })
      await simulateNativeSalePacket(client, record.packet, signal); guard(); await sameHead()
    }
    const bytes = fromBase64(record.packet.bytes)
    const verify = (signature: string, abort: AbortSignal) =>
      profileReadStep(abort, () => verifyTransactionSignature(bytes, signature, { address: plan.buyer, client: signatureClient }))
    await sameHead()
    const before = await query()
    if (before.status !== 'MISSING' || record.packet.phase === 'CANCELLED') return { record, result: before }
    guard()
    check(plan.offerId === activeOfferId && canonical(activeRelease) === canonical(release) && typeof client.core.executeTransaction === 'function', 'SALE_CHECKOUT_SELECTED_OFFER_CHANGED')
    await assertSameSoulForeignHeads({ scopes: [scope], ownKeys: [key], signal, port: createBrowserSameSoulHeadPort(client, undefined, signal) })
    if (record.packet.phase !== 'SIGNED') {
      await preflight()
      const ready = await query()
      if (ready.status !== 'MISSING') return { record, result: ready }
      if (record.packet.phase === 'PREPARED') await save('SIGNING')
      guard()
      const signed = await sign(Transaction.from(bytes))
      check(signed.bytes === record.packet.bytes && typeof signed.signature === 'string'
        && signed.signature.length > 0 && signed.signature.length <= 32768, 'SALE_CHECKOUT_SIGNED_BYTES')
      await verify(signed.signature, AbortSignal.timeout(15000))
      await save('SIGNED', signed.signature)
    }
    guard()
    const signature = record.packet.signature
    check(signature, 'SALE_CHECKOUT_SIGNATURE_REQUIRED')
    await verify(signature, signal)
    await preflight()
    const ready = await query()
    if (ready.status !== 'MISSING') return { record, result: ready }
    await sameHead(); guard()
    let sendError: unknown
    try { await client.core.executeTransaction({ transaction: bytes, signatures: [signature], signal }) }
    catch (error) { sendError = error }
    const result = await query()
    if (sendError && result.status === 'MISSING') throw sendError
    return { record, result }
  })
}

const clockId = '0x' + '6'.padStart(64, '0')
const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })
async function readSaleClock(client: SuiGrpcClient, signal: AbortSignal) {
  const row = await readCommerceObject(client, clockId, '0x2::clock::Clock', signal), value = decodeCommerce(Clock, row.contents)
  check(value.id === clockId && row.owner.Shared?.initialSharedVersion === '1', 'SALE_CHECKOUT_CLOCK')
  return BigInt(value.timestamp_ms)
}
