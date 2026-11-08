import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck as check } from './commerce/economics-read'
import { buildNativeSellerTransaction, prepareNativeSellerPlan, recheckNativeSellerPlan } from './commerce/native-sale-seller-plan'
import { simulateNativeSalePacket } from './commerce/native-sale-simulation'
import { captureAccountOriginalReadClientV155 } from './management/account-original-readers-v155'
import { captureSameSoulMarketExecutionClient, captureSameSoulMutationClient } from './same-soul-mutation-client'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from './same-soul-mutation-heads'
import { withSoulAccessAssetLock, type SoulAccessAssetScope } from './soul-access-asset-lock'
import { nativeSaleCheckoutInstalled, type NativeSaleCheckoutRelease } from './native-sale-checkout-config'
import { browserNativeSellerJournal, nativeSellerKey, nativeSellerScope, parseNativeSellerRecord,
  queryNativeSellerOriginal, type NativeSellerRecord } from './native-sale-seller-journal'

type Journal = ReturnType<typeof browserNativeSellerJournal>
function exclusive<T>(scope: SoulAccessAssetScope, work: (journal: Journal, key: string) => Promise<T>) {
  const journal = browserNativeSellerJournal(), key = nativeSellerKey(scope)
  return withSoulAccessAssetLock(scope, () => journal.exclusive(key, () => work(journal, key)))
}
async function sameHead(journal: Journal, key: string, expected: NativeSellerRecord | null) {
  check(canonical(await journal.read(key)) === canonical(expected), 'SELLER_HEAD_CHANGED')
}
async function save(journal: Journal, key: string, expected: NativeSellerRecord | null, record: NativeSellerRecord) {
  await sameHead(journal, key, expected)
  let failure: unknown, failed = false
  try { await journal.write(key, record) } catch (error) { failure = error; failed = true }
  const observed = await journal.read(key)
  if (failed) throw failure
  check(canonical(observed) === canonical(record), 'SELLER_PERSISTENCE')
  return record
}
function checkTerminal(record: NativeSellerRecord, status: string) {
  check(!['SUCCEEDED', 'FAILED'].includes(record.packet.phase) || record.packet.phase === status, 'SELLER_TERMINAL_CONTRADICTION')
}
function walletGuard(release: NativeSaleCheckoutRelease, seller: string, getSellerAddress: () => string | null, signal: AbortSignal) {
  signal.throwIfAborted()
  check(nativeSaleCheckoutInstalled(release) && getSellerAddress() === seller, 'SELLER_WALLET_OR_SOURCE_CHANGED')
}
function excludeForeign(client: SuiGrpcClient, signal: AbortSignal, scope: SoulAccessAssetScope, key: string) {
  return assertSameSoulForeignHeads({ scopes: [scope], ownKeys: [key], signal, port: createBrowserSameSoulHeadPort(client, undefined, signal) })
}

export function prepareNativeSellerOriginal(input: Parameters<typeof prepareNativeSellerPlan>[0]) {
  const { client: source, signal: parent, getSellerAddress, ...rest } = input
  const request = structuredClone(rest)
  const signal = AbortSignal.any([parent, AbortSignal.timeout(90000)])
  const client = captureSameSoulMutationClient(source, signal)
  const { release, intent } = request
  const scope = { chainIdentifier: release.target.chainIdentifier, soulId: intent.soulId, author: intent.seller }
  const guard = () => walletGuard(release, intent.seller, getSellerAddress, signal)
  return exclusive(scope, async (journal, key) => {
    guard()
    const previous = await journal.read(key)
    if (previous) {
      const result = await queryNativeSellerOriginal(previous, client, signal)
      checkTerminal(previous, result.status)
      if (!(previous.packet.phase === 'CANCELLED' && result.status === 'MISSING')
        && !['SUCCEEDED', 'FAILED'].includes(previous.packet.phase)) return { record: previous, prepared: false }
    }
    await excludeForeign(client, signal, scope, key); guard()
    const plan = await prepareNativeSellerPlan({ ...request, client, signal, getSellerAddress })
    const bytes = await buildNativeSellerTransaction(plan).build()
    const packet: PublicMutationPacket = { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      expirationEpoch: plan.expirationEpoch, phase: 'PREPARED', signature: null }
    check(previous?.packet.digest !== packet.digest, 'SELLER_PREVIOUS_PACKET_REUSE')
    const record: NativeSellerRecord = { schema: 'soulidity.native-sale-seller.v1', plan, packet }
    guard()
    await save(journal, key, previous, record)
    guard()
    await simulateNativeSalePacket(client, packet, signal)
    guard()
    return { record, prepared: true }
  })
}

/** Only the current local head may be changed. Historical lookup is available
 * separately without a wallet, journal lock, or current deployment selection. */
export function reconcileNativeSellerOriginal(input: { record: NativeSellerRecord; client: SuiGrpcClient; signal: AbortSignal; cancelUnsigned?: true }) {
  const record = structuredClone(input.record), signal = AbortSignal.any([input.signal, AbortSignal.timeout(90000)])
  const client = captureSameSoulMutationClient(input.client, signal), cancel = input.cancelUnsigned === true
  return exclusive(nativeSellerScope(record.plan), async (journal, key) => {
    await sameHead(journal, key, record)
    if (cancel) check(record.packet.phase === 'PREPARED' && record.packet.signature === null, 'SELLER_UNSIGNED_ONLY')
    const result = await queryNativeSellerOriginal(record, client, signal)
    signal.throwIfAborted(); checkTerminal(record, result.status)
    if (cancel) check(result.status === 'MISSING', 'SELLER_ORIGINAL_FOUND')
    const phase = cancel ? 'CANCELLED' : result.status === 'SUCCEEDED' || result.status === 'FAILED' ? result.status : record.packet.phase
    if (phase === record.packet.phase) return { record, result }
    return { record: await save(journal, key, record, { ...record, packet: { ...record.packet, phase } }), result }
  })
}

export function executeNativeSellerOriginal(input: {
  record: NativeSellerRecord; activeRelease: NativeSaleCheckoutRelease; client: SuiGrpcClient; signal: AbortSignal
  getSellerAddress: () => string | null; sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
}) {
  const { client: source, getSellerAddress, sign } = input, selected = structuredClone(input.record)
  const activeRelease = structuredClone(input.activeRelease), scope = nativeSellerScope(selected.plan)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180000)])
  const client = captureSameSoulMarketExecutionClient(source, signal), signatureClient = captureAccountOriginalReadClientV155(source)
  const guard = () => walletGuard(activeRelease, scope.author, getSellerAddress, signal)
  return exclusive(scope, async (journal, key) => {
    let record = await parseNativeSellerRecord(selected)
    const bytes = fromBase64(record.packet.bytes)
    async function phase(next: PublicMutationPacket['phase'], signature = record.packet.signature) {
      record = await save(journal, key, record, { ...record, packet: { ...record.packet, phase: next, signature } })
    }
    async function query() {
      const result = await queryNativeSellerOriginal(record, client, signal)
      signal.throwIfAborted(); checkTerminal(record, result.status)
      if ((result.status === 'SUCCEEDED' || result.status === 'FAILED') && result.status !== record.packet.phase) await phase(result.status)
      return result
    }
    async function preflight() {
      guard()
      await recheckNativeSellerPlan(record.plan, { client, signal, getSellerAddress })
      await simulateNativeSalePacket(client, record.packet, signal); guard(); await sameHead(journal, key, record)
    }
    const verify = (signature: string, abort: AbortSignal) =>
      profileReadStep(abort, () => verifyTransactionSignature(bytes, signature, { address: scope.author, client: signatureClient }))
    await sameHead(journal, key, record)
    const before = await query()
    if (before.status !== 'MISSING' || record.packet.phase === 'CANCELLED') return { record, result: before }
    guard()
    check(canonical(record.plan.release) === canonical(activeRelease) && typeof client.core.executeTransaction === 'function', 'SELLER_SOURCE_CHANGED')
    await excludeForeign(client, signal, scope, key)
    if (record.packet.phase !== 'SIGNED') {
      await preflight()
      const ready = await query()
      if (ready.status !== 'MISSING') return { record, result: ready }
      if (record.packet.phase === 'PREPARED') await phase('SIGNING')
      guard()
      const signed = await sign(Transaction.from(bytes))
      check(signed.bytes === record.packet.bytes && typeof signed.signature === 'string'
        && signed.signature.length > 0 && signed.signature.length <= 32768, 'SELLER_SIGNED_BYTES')
      await verify(signed.signature, AbortSignal.timeout(15000))
      await phase('SIGNED', signed.signature)
    }
    guard()
    const signature = record.packet.signature
    check(signature, 'SELLER_SIGNATURE_REQUIRED')
    await verify(signature, signal)
    await preflight()
    const ready = await query()
    if (ready.status !== 'MISSING') return { record, result: ready }
    await sameHead(journal, key, record); guard()
    let failure: unknown
    try { await client.core.executeTransaction({ transaction: bytes, signatures: [signature], signal }) }
    catch (error) { failure = error }
    const result = await query()
    if (failure && result.status === 'MISSING') throw failure
    return { record, result }
  })
}
