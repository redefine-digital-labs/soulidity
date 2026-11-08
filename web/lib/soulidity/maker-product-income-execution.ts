import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { publicMutationCanonical, type PublicMutationPacket } from '../sui/public-mutation-journal'
import { commerceCheck } from './commerce/economics-read'
import type { IncomeExecutionRegistryV1 } from './commerce/income-execution-source-v1'
import { captureMakerProductIncomeClient } from './commerce/maker-product-income-client'
import { importMakerProductIncomeRecoveryRecord, type MakerProductIncomeRecoveryRecord } from './commerce/maker-product-income-recovery-record'
import { recheckMakerProductIncomePrepared } from './commerce/maker-product-income-resume'
import { MakerProductIncomeRecoveryError, type MakerProductIncomeRecovery } from './maker-product-income-host'
import { browserMakerProductIncomeJournal, captureMakerProductIncomeJournal, makerProductIncomeFundKey, makerProductIncomeHeadCanClear,
  parseMakerProductIncomeOperation, persistMakerProductIncomeHead, queryMakerProductIncomeOriginal,
  type MakerProductIncomeJournal, type MakerProductIncomeOperation } from './maker-product-income-journal'

export interface MakerProductIncomeWalletSigner {
  getActorAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}
type Review = Pick<Parameters<typeof recheckMakerProductIncomePrepared>[0], 'reviewed' | 'reviewedGas'>
export interface MakerProductIncomeExecutionInput {
  selected: MakerProductIncomeOperation
  signal: AbortSignal
  wallet: MakerProductIncomeWalletSigner
  isCurrent: () => boolean
}

/** Execute one exact local head. All irreversible stages share the existing
 * Product exclusion; ambiguous transport/persistence preserves that head. */
export function executeMakerProductIncomeOriginal(input: MakerProductIncomeExecutionInput & {
  client: SuiGrpcClient; executionRegistry: IncomeExecutionRegistryV1; journal?: MakerProductIncomeJournal
  readCurrentReview: (original: MakerProductIncomeRecoveryRecord, client: SuiGrpcClient, signal: AbortSignal) => Promise<Review>
}) {
  const selected = structuredClone(input.selected), key = makerProductIncomeFundKey(selected.plan)
  const source = input.client, client = captureMakerProductIncomeClient(source), registry = input.executionRegistry
  const submit = source.core.executeTransaction?.bind(source.core)
  const sign = input.wallet.sign, getActorAddress = input.wallet.getActorAddress
  const isCurrent = input.isCurrent, readCurrentReview = input.readCurrentReview
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(180000)])
  const journal = captureMakerProductIncomeJournal(input.journal ?? browserMakerProductIncomeJournal())
  return journal.exclusive(key, async () => {
    const expected = await parseMakerProductIncomeOperation(selected)
    const original = importMakerProductIncomeRecoveryRecord(expected.plan.originalText)
    const recovery: MakerProductIncomeRecovery = { text: expected.plan.originalText, digest: expected.packet.digest,
      headPhase: expected.packet.phase, durability: 'UNCONFIRMED' }
    let record = expected
    const guard = () => {
      signal.throwIfAborted()
      commerceCheck(isCurrent() && getActorAddress() === original.intent.actor, 'MAKER_INCOME_EXECUTION_WALLET_OR_SOURCE_CHANGED')
    }
    async function sameHead(requireLiveOperation = true) {
      const head = await journal.read(key)
      if (requireLiveOperation) signal.throwIfAborted()
      commerceCheck(head && publicMutationCanonical(head) === publicMutationCanonical(record), 'MAKER_INCOME_EXECUTION_HEAD_CHANGED')
    }
    async function save(phase: PublicMutationPacket['phase'], signature = record.packet.signature) {
      // A settled, verified signature belongs to the locked original even if the view closed.
      await sameHead(phase !== 'SIGNED')
      if (phase === 'SIGNING') guard()
      const next = { ...record, packet: { ...record.packet, phase, signature } }
      recovery.durability = 'UNCONFIRMED'
      await persistMakerProductIncomeHead(journal, key, next, () => {
        record = next
        recovery.headPhase = phase
        recovery.durability = 'CONFIRMED'
      })
      signal.throwIfAborted()
    }
    async function query() {
      const result = await queryMakerProductIncomeOriginal({ record, client, signal, executionRegistry: registry })
      signal.throwIfAborted()
      makerProductIncomeHeadCanClear(record, result)
      const phase = result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? 'SUCCEEDED' : result.status === 'FAILED' ? 'FAILED' : null
      if (phase && record.packet.phase !== phase) await save(phase)
      return result
    }
    async function preflight() {
      guard()
      const review = await readCurrentReview(structuredClone(original), client, signal)
      guard()
      const checked = await recheckMakerProductIncomePrepared({ ...review, record: original, client, signal, getActorAddress, executionRegistry: registry })
      commerceCheck(checked.simulation.simulationVerified, 'MAKER_INCOME_EXECUTION_MODEL_UNQUALIFIED')
      await sameHead()
      guard()
    }
    const bytes = fromBase64(original.packet.bytes)
    async function verify(signature: string, verificationSignal = signal) {
      await profileReadStep(verificationSignal, () => verifyTransactionSignature(bytes, signature, { address: original.intent.actor, client: source }))
    }
    try {
      await sameHead(); recovery.durability = 'CONFIRMED'
      const before = await query()
      if (before.status !== 'MISSING' || ['CANCELLED', 'RETIRED'].includes(record.packet.phase)) return { record, original: before }
      guard()
      commerceCheck(typeof submit === 'function' && ['PREPARED', 'SIGNING', 'SIGNED'].includes(record.packet.phase), 'MAKER_INCOME_EXECUTION_UNAVAILABLE')

      if (record.packet.phase !== 'SIGNED') {
        await preflight()
        if (record.packet.phase === 'PREPARED') await save('SIGNING')
        guard()
        // The wallet promise is held under this exclusion until it settles.
        const signed = await sign(Transaction.from(original.packet.bytes))
        commerceCheck(signed.bytes === original.packet.bytes, 'MAKER_INCOME_EXECUTION_WALLET_CHANGED_BYTES')
        await verify(signed.signature, AbortSignal.timeout(15000))
        await save('SIGNED', signed.signature)
      }
      guard()
      const signature = record.packet.signature
      commerceCheck(record.packet.phase === 'SIGNED' && signature, 'MAKER_INCOME_EXECUTION_SIGNATURE_REQUIRED')
      await verify(signature)
      await preflight()
      const ready = await query()
      if (ready.status !== 'MISSING') return { record, original: ready }
      await sameHead()
      guard()
      let submitError: unknown
      try { await submit({ transaction: bytes, signatures: [signature], signal }) }
      catch (error) { submitError = error }
      signal.throwIfAborted()
      const observed = await query()
      if (submitError && observed.status === 'MISSING') throw submitError
      return { record, original: observed }
    } catch (error) {
      throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_EXECUTION_FAILED', recovery, { cause: error })
    }
  })
}
