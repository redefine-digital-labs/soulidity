import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import { IncomeWithdrawalHostRecoveryError, type IncomeWithdrawalHostRecovery } from './commerce/income-withdrawal-host-preflight'
import { importIncomeWithdrawalRecoveryRecord } from './commerce/income-withdrawal-recovery-record'
import { recheckPreparedIncomeWithdrawal } from './commerce/income-withdrawal-resume-preflight'
import { captureAccountOriginalReadClientV155 } from './management/account-original-readers-v155'
import { captureSameSoulMarketExecutionClient } from './same-soul-mutation-client'
import { withIncomeWithdrawalFundLock } from './income-withdrawal-fund-lock'
import { browserIncomeWithdrawalJournalV1, captureIncomeWithdrawalJournalV1, incomeWithdrawalFundKeyV1,
  incomeWithdrawalHeadCanClearV1, parseIncomeWithdrawalJournalRecordV1, persistIncomeWithdrawalHeadV1,
  queryIncomeWithdrawalJournalOriginalV1 } from './income-withdrawal-journal-v1'
import type { recheckSelectedIncomeWithdrawalOriginalV1 } from './income-withdrawal-original-recovery'

type ExecutionInput = Parameters<typeof recheckSelectedIncomeWithdrawalOriginalV1>[0] & {
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}

/** The funds and journal locks cover the original through signature, submission
 * and receipt readback. Root supplies live source qualification. */
export function executeIncomeWithdrawalOriginalV1(input: ExecutionInput) {
  const selected = structuredClone(input.selected), key = incomeWithdrawalFundKeyV1(selected.plan)
  const original = importIncomeWithdrawalRecoveryRecord(selected.plan.originalText)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180000)])
  const client = captureSameSoulMarketExecutionClient(input.client, signal)
  // A late signature can still be authenticated and saved for this original.
  const signatureClient = captureAccountOriginalReadClientV155(input.client)
  const journal = captureIncomeWithdrawalJournalV1(input.journal ?? browserIncomeWithdrawalJournalV1())
  const { getActorAddress, isCurrent, readCurrentReview, sign, executionRegistry } = input
  const guard = () => {
    signal.throwIfAborted()
    commerceCheck(isCurrent() && getActorAddress() === original.intent.actor, 'WITHDRAW_EXECUTION_SOURCE_OR_WALLET_CHANGED')
  }

  return withIncomeWithdrawalFundLock(selected.plan, () => journal.exclusive(key, async () => {
    signal.throwIfAborted()
    let record = await parseIncomeWithdrawalJournalRecordV1(selected)
    const recovery: IncomeWithdrawalHostRecovery = { text: record.plan.originalText, digest: record.packet.digest,
      headPhase: record.packet.phase, durability: 'UNCONFIRMED' }

    async function sameHead() {
      commerceCheck(canonical(await journal.read(key)) === canonical(record), 'WITHDRAW_EXECUTION_HEAD_CHANGED')
    }

    async function save(phase: PublicMutationPacket['phase'], signature = record.packet.signature) {
      await sameHead()
      if (phase === 'SIGNING') guard()
      const next = { ...record, packet: { ...record.packet, phase, signature } }
      recovery.durability = 'UNCONFIRMED'
      record = await persistIncomeWithdrawalHeadV1(journal, key, next, () => {
        recovery.headPhase = phase
        recovery.durability = 'CONFIRMED'
      })
    }

    async function query() {
      const result = await queryIncomeWithdrawalJournalOriginalV1({ record, client, signal, executionRegistry })
      signal.throwIfAborted()
      incomeWithdrawalHeadCanClearV1(record, result)
      const phase = result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? 'SUCCEEDED' : result.status === 'FAILED' ? 'FAILED' : null
      if (phase && record.packet.phase !== phase) await save(phase)
      return result
    }

    async function recheck() {
      guard()
      const review = await readCurrentReview(structuredClone(original), client, signal)
      guard()
      await recheckPreparedIncomeWithdrawal({ ...review, record: original, client, signal, getActorAddress, executionRegistry })
      guard()
      await sameHead()
      guard()
    }

    const bytes = fromBase64(record.packet.bytes)
    const verify = (signature: string, verifySignal: AbortSignal) =>
      profileReadStep(verifySignal, () => verifyTransactionSignature(bytes, signature, { address: original.intent.actor, client: signatureClient }))
    try {
      await sameHead()
      recovery.durability = 'CONFIRMED'
      const before = await query()
      if (before.status !== 'MISSING' || ['CANCELLED', 'RETIRED'].includes(record.packet.phase)) return { record, original: before }
      guard()
      commerceCheck(typeof client.core.executeTransaction === 'function' && ['PREPARED', 'SIGNING', 'SIGNED'].includes(record.packet.phase),
        'WITHDRAW_EXECUTION_UNAVAILABLE')

      if (record.packet.phase !== 'SIGNED') {
        await recheck()
        const ready = await query()
        if (ready.status !== 'MISSING') return { record, original: ready }
        if (record.packet.phase === 'PREPARED') await save('SIGNING')
        guard()
        const signed = await sign(Transaction.from(bytes))
        commerceCheck(signed.bytes === original.packet.bytes && typeof signed.signature === 'string'
          && signed.signature.length > 0 && signed.signature.length <= 32768, 'WITHDRAW_EXECUTION_SIGNED_BYTES_CHANGED')
        await verify(signed.signature, AbortSignal.timeout(15000))
        await save('SIGNED', signed.signature)
      }

      guard()
      const signature = record.packet.signature
      commerceCheck(signature, 'WITHDRAW_EXECUTION_SIGNATURE_REQUIRED')
      await verify(signature, signal)
      await recheck()
      const ready = await query()
      if (ready.status !== 'MISSING') return { record, original: ready }
      await sameHead()
      guard()
      let submitError: unknown
      try { await client.core.executeTransaction({ transaction: bytes, signatures: [signature], signal }) }
      catch (error) { submitError = error }
      const result = await query()
      if (submitError && result.status === 'MISSING') throw submitError
      return { record, original: result }
    } catch (error) {
      throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'WITHDRAW_EXECUTION_FAILED', recovery, { cause: error })
    }
  }))
}
