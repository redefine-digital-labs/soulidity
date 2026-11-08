import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import type { NativePublicReadPaidHostRequestV2 } from './commerce/native-public-read-paid-host-preflight-v2'
import type { NativePublicReadPaidPreparedOriginalV2 } from './commerce/native-public-read-paid-preflight-v2'
import { reviewNativePublicReadPaidInputsV2 } from './commerce/native-public-read-paid-input-provider-v2'
import { simulateNativePublicReadPaidPurchaseV2 } from './commerce/native-public-read-paid-simulation-v2'
import { parsePurchaseRecoveryOriginal } from './commerce/purchase-recovery-original'
import { verifyNativePaidContentApprovalV2Interface } from './native-paid-content-approval-v2'
import { captureAccountOriginalReadClientV155 } from './management/account-original-readers-v155'
import { captureSameSoulMarketExecutionClient } from './same-soul-mutation-client'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from './same-soul-mutation-heads'
import { withSoulAccessAssetLock } from './soul-access-asset-lock'
import { browserNativePublicReadPaidJournalV2, nativePublicReadPaidKeyV2, parseNativePublicReadPaidRecordV2,
  nativePublicReadPaidSettlementMatchesV2, queryNativePublicReadPaidRecordV2, type NativePublicReadPaidRecordV2 } from './native-public-read-paid-journal-v2'
import { NativePublicReadPaidHostRecoveryErrorV2, type NativePublicReadPaidRecoveryV2 } from './native-public-read-paid-host-v2'

type Reviewed = Extract<Awaited<ReturnType<typeof reviewNativePublicReadPaidInputsV2>>, { status: 'PURCHASE_INPUTS_REVIEWED' }>

/** The compiled Root must supply active source and parent-commit qualification.
 * Only a guarded packet retained in the canonical journal can be sent. */
export function executeNativePublicReadPaidOriginalV2(input: {
  selected: NativePublicReadPaidRecordV2
  qualification: NativePublicReadPaidHostRequestV2['qualification']
  isCurrent: () => boolean
  getBuyerAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  qualifySource: (proof: {
    original: NativePublicReadPaidPreparedOriginalV2
    review: Reviewed['reviewed']
    simulation: Awaited<ReturnType<typeof simulateNativePublicReadPaidPurchaseV2>>
    signal: AbortSignal
  }) => Promise<void>
}) {
  const expected = structuredClone(input.selected), scope = expected.plan, key = nativePublicReadPaidKeyV2(scope)
  const { client: source, signal: parent, ...selection } = input.qualification
  const signal = AbortSignal.any([parent, AbortSignal.timeout(180000)])
  const client = captureSameSoulMarketExecutionClient(source, signal)
  // The original verifier can authenticate a late zkLogin signature even if
  // the execution lease was revoked. It has no dispatch capability.
  const signatureClient = captureAccountOriginalReadClientV155(source)
  const qualification = { ...structuredClone(selection), client, signal }
  const { isCurrent, getBuyerAddress, sign, qualifySource } = input
  const guard = () => {
    signal.throwIfAborted()
    commerceCheck(isCurrent() && getBuyerAddress() === scope.author, 'PUBLIC_PAID_V2_EXECUTION_WALLET_OR_SOURCE_CHANGED')
  }
  const journal = browserNativePublicReadPaidJournalV2()
  const heads = createBrowserSameSoulHeadPort(client, undefined, signal)
  return withSoulAccessAssetLock(scope, () => journal.exclusive(key, async () => {
    let record = await parseNativePublicReadPaidRecordV2(expected)
    const parsed = await parsePurchaseRecoveryOriginal(record.plan.originalText, scope.soulId)
    commerceCheck(parsed.kind === 'native-public-read-v2', 'PUBLIC_PAID_V2_EXECUTION_FORMAT')
    const original = parsed.value, intent = original.intent
    const recovery: NativePublicReadPaidRecoveryV2 = { format: 'native-public-read-v2', text: scope.originalText,
      digest: record.packet.digest, soulId: scope.soulId, durability: 'UNCONFIRMED' }

    async function sameHead() {
      commerceCheck(canonical(await journal.read(key)) === canonical(record), 'PUBLIC_PAID_V2_EXECUTION_HEAD_CHANGED')
    }
    async function save(phase: PublicMutationPacket['phase'], signature = record.packet.signature) {
      await sameHead()
      if (phase === 'SIGNING') guard()
      const next = { ...record, packet: { ...record.packet, phase, signature } }
      recovery.durability = 'UNCONFIRMED'
      await journal.write(key, next)
      record = next
      await sameHead()
      recovery.durability = 'CONFIRMED'
    }
    async function query() {
      const result = await queryNativePublicReadPaidRecordV2(record, client, signal)
      signal.throwIfAborted()
      const settled = nativePublicReadPaidSettlementMatchesV2(record, result)
      commerceCheck((record.packet.phase !== 'FAILED' || result.status === 'FAILED')
        && (record.packet.phase !== 'SUCCEEDED' || settled), 'PUBLIC_PAID_V2_EXECUTION_TERMINAL_CONTRADICTION')
      if (settled && record.packet.phase !== 'SUCCEEDED') await save('SUCCEEDED')
      if (result.status === 'FAILED' && record.packet.phase !== 'FAILED') await save('FAILED')
      return result
    }
    async function recheck() {
      guard()
      const binding = intent.recordGuard
      commerceCheck(binding && qualification.soulId === scope.soulId && qualification.buyer === scope.author
        && qualification.kind === intent.kind && qualification.recordIndex === binding.index
        && canonical(qualification.target) === canonical(original.context.target)
        && canonical(qualification.economics) === canonical(original.context.economics), 'PUBLIC_PAID_V2_EXECUTION_SELECTION')
      const { objectId, version, digest } = intent.paymentCoin
      const purchase = { paymentCoin: { objectId, version, digest }, gas: original.reviewedGas,
        expirationEpoch: original.packet.expirationEpoch, quoteExpiryMs: intent.quoteExpiryMs, attempt: intent.attempt }
      const observed = await reviewNativePublicReadPaidInputsV2({ qualification, purchase, getBuyerAddress }); guard()
      commerceCheck(observed.status === 'PURCHASE_INPUTS_REVIEWED', 'PUBLIC_PAID_V2_EXECUTION_PURCHASE_NOT_CURRENT')
      const q = observed.reviewed
      commerceCheck(q.namespace === binding.namespace && q.ledgerId === original.context.originalReceiptContext.ledgerId
        && q.quote && toHex(q.quote.hash) === toHex(intent.quote.hash) && q.quote.total === intent.quote.total
        && q.coinType === intent.coinType && q.feeRevision === intent.feeRevision
        && q.entryHash === (intent.entryHash ? toHex(intent.entryHash) : null)
        && canonical(q.offer) === canonical(original.context.originalQuotedOffer)
        && canonical(q.offerReference) === canonical(original.context.originalOfferReference)
        && canonical(q.configSharedReference) === canonical(intent.config)
        && q.shared.host.objectId === intent.host.objectId && q.shared.host.initialSharedVersion === intent.host.initialSharedVersion
        && q.shared.kiosk.objectId === intent.kiosk.objectId && q.shared.kiosk.initialSharedVersion === intent.kiosk.initialSharedVersion
        && canonical(observed.funding.coins[0]) === canonical(intent.paymentCoin), 'PUBLIC_PAID_V2_EXECUTION_QUOTE_OR_RESOURCES_CHANGED')
      await verifyNativePaidContentApprovalV2Interface({ client, native: qualification.target.native, signal }); guard()
      const simulation = await simulateNativePublicReadPaidPurchaseV2({
        ...original.context.originalReceiptContext, client, intent, packet: original.packet, gas: original.reviewedGas,
        signal, getBuyerAddress,
      }); guard()
      await qualifySource({ original: structuredClone(original), review: structuredClone(q), simulation: structuredClone(simulation), signal })
      guard()
      await sameHead()
    }
    const bytes = fromBase64(original.packet.bytes)
    const verify = (signature: string, verifySignal: AbortSignal) =>
      profileReadStep(verifySignal, () => verifyTransactionSignature(bytes, signature, { address: scope.author, client: signatureClient }))
    try {
      await sameHead(); recovery.durability = 'CONFIRMED'
      if (record.packet.phase === 'RETIRED') return { record, original: await queryNativePublicReadPaidRecordV2(record, client, signal) }
      const before = await query()
      if (before.status !== 'MISSING' || record.packet.phase === 'CANCELLED') return { record, original: before }
      guard()
      commerceCheck(typeof qualifySource === 'function' && typeof client.core.executeTransaction === 'function'
        && ['PREPARED', 'SIGNING', 'SIGNED'].includes(record.packet.phase), 'PUBLIC_PAID_V2_EXECUTION_UNAVAILABLE')
      await assertSameSoulForeignHeads({ scopes: [scope], ownKeys: [key], port: heads, signal })
      if (record.packet.phase !== 'SIGNED') {
        await recheck()
        const ready = await query()
        if (ready.status !== 'MISSING') return { record, original: ready }
        if (record.packet.phase === 'PREPARED') await save('SIGNING')
        guard()
        const signed = await sign(Transaction.from(bytes))
        commerceCheck(signed.bytes === original.packet.bytes && typeof signed.signature === 'string'
          && signed.signature.length > 0 && signed.signature.length <= 32768, 'PUBLIC_PAID_V2_EXECUTION_CHANGED_SIGNED_BYTES')
        await verify(signed.signature, AbortSignal.timeout(15000))
        // A valid late signature still belongs to the locked original.
        await save('SIGNED', signed.signature)
      }
      guard()
      const signature = record.packet.signature
      commerceCheck(signature, 'PUBLIC_PAID_V2_EXECUTION_SIGNATURE_REQUIRED')
      await verify(signature, signal)
      await recheck()
      const ready = await query()
      if (ready.status !== 'MISSING') return { record, original: ready }
      await sameHead(); guard()
      let submitError: unknown
      try { await client.core.executeTransaction({ transaction: bytes, signatures: [signature], signal }) }
      catch (error) { submitError = error }
      const observed = await query()
      if (submitError && observed.status === 'MISSING') throw submitError
      return { record, original: observed }
    } catch (error) {
      throw new NativePublicReadPaidHostRecoveryErrorV2(error instanceof Error ? error.message : 'PUBLIC_PAID_V2_EXECUTION_FAILED', recovery, { cause: error })
    }
  }))
}
