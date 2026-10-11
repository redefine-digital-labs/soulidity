import type { SoulAuthoringPreparation } from './soul-authoring-store'
import type { SoulAuthoringPacketJournal } from './soul-authoring-journal'
import type { SoulAuthoringPacketRecord } from './soul-authoring-packet'
import type { createSoulAuthoringWallet } from './soul-authoring-wallet'
import type { SoulAuthoringBusinessReceipt } from './soul-authoring-history'
import type { SoulAuthoringKiosk } from './soul-authoring-transaction'

export interface CollectionAuthoringResult {
  txDigest: string; collectionOnChainId: string; rightOnChainId: string; listingStatus: string
  soulCount: number; currentSoulSupply: number; maxSoulSupply: string | null; authoringCompletionKey?: string
}
type Execution = ReturnType<typeof createSoulAuthoringWallet>
type Outcome = Awaited<ReturnType<Execution['run']>>
const selected = (record: SoulAuthoringPacketRecord) => ({ bytes: record.packet.bytes, digest: record.packet.digest })
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** Original Collection launch: prove all completed rows, accept their durable
 * uploads before advancement, and stop at the first unresolved packet. A chunk
 * is not the Collection result. All writes/signatures still use the locked runner. */
export async function advanceCollectionAuthoring(params: {
  preparation: SoulAuthoringPreparation; journal: SoulAuthoringPacketJournal; key: string; execution: Execution
  signal: AbortSignal; queryOnly: boolean; retryPacket?: { bytes: string; digest: string; retired?: boolean }
  resolveKiosk: () => Promise<SoulAuthoringKiosk>
  progress: (completed: number, total: number) => void
}): Promise<{ result: CollectionAuthoringResult | null; pending: Outcome | null }> {
  const { preparation: p, execution, journal, key, signal } = params, request = p.manifest.request
  check(request.collection, 'This saved operation is not a Collection launch.')
  let retry = params.retryPacket
  for (let turn = 0; turn <= request.mints.length + 2; turn++) {
    signal.throwIfAborted()
    let head = await journal.read(key)
    const history = await journal.history(key)
    signal.throwIfAborted()
    check(history.length <= 2048, 'Saved Collection history exceeds its bound.')
    if (!head) {
      check(!history.length, 'Collection history has no current transaction.')
      if (params.queryOnly) return { result: null, pending: null }
      const outcome = await execution.run({ kind: 'REGISTER', kiosk: await params.resolveKiosk() })
      if (outcome.status !== 'SUCCEEDED') return { result: null, pending: outcome }
      continue
    }
    // Journal history is keyed by digest, not execution order. Restore REGISTER
    // acceptance before any mint consumption, and process current head last.
    history.sort((a, b) => a.plan.step.kind === 'REGISTER' ? -1 : b.plan.step.kind === 'REGISTER' ? 1
      : a.plan.step.chunk.mintIndices[0] - b.plan.step.chunk.mintIndices[0])
    const all = [...history, head]
    check(new Set(all.map(r => r.packet.digest)).size === all.length, 'Duplicated Collection packet history.')
    let registration: SoulAuthoringBusinessReceipt | null = null
    const minted: number[] = [], consumed: number[] = []; let mintPackets = 0, publicPackets = 0
    let pending: Outcome | null = null
    for (const record of all) {
      signal.throwIfAborted()
      let proof = await execution.query(record)
      signal.throwIfAborted()
      if (record.packet.phase === 'SUCCEEDED' || record.packet.phase === 'FAILED')
        check(proof.status === record.packet.phase, 'Collection terminal history contradicts its fresh proof.')
      const isHead = record.packet.digest === head.packet.digest
      if (isHead && !params.queryOnly) {
        if (retry) check(record.packet.bytes === retry.bytes && record.packet.digest === retry.digest,
          'The selected Collection transaction changed. Query it before retrying.')
        const step = !retry ? record.plan.step : record.plan.step.kind === 'REGISTER'
          ? { kind: 'REGISTER' as const, kiosk: await params.resolveKiosk() }
          : { kind: 'MINT' as const, chunk: { ...record.plan.step.chunk, kiosk: await params.resolveKiosk() } }
        const outcome = await execution.run(step, retry ? { startNew: true, expectedPacket: retry } : {})
        retry = undefined
        // A cold resume has no previous UI progress. Preserve the freshly
        // proved historical rows even when the current packet cannot advance.
        if (outcome.status !== 'SUCCEEDED') { pending = outcome; break }
        // A retry changes the head. Read its complete history on the next pass.
        if (outcome.record.packet.digest !== record.packet.digest) { head = outcome.record; pending = outcome; break }
        proof = outcome
      }
      if (proof.status !== 'SUCCEEDED') {
        if (!isHead && (proof.status === 'FAILED' || proof.status === 'MISSING' && ['CANCELLED', 'RETIRED'].includes(record.packet.phase))) continue
        if (isHead) { pending = { ...proof, record } as Outcome; continue }
        throw new Error('An earlier Collection transaction is unresolved. No new payment is allowed.')
      }
      check(!['FAILED', 'CANCELLED', 'RETIRED'].includes(record.packet.phase), 'Collection history contradicts its confirmed receipt.')
      if (!params.queryOnly && !isHead) await execution.accept(record)
      const business = proof.receipt.business
      check(business.transactionDigest === record.packet.digest, 'Collection receipt does not match its transaction.')
      if (record.plan.step.kind === 'REGISTER') {
        check(!registration && business.stage === 'REGISTER' && business.collection, 'Collection needs exactly one proved registration.')
        registration = business
      } else {
        const indices = business.mints.map(m => m.mintIndex)
        check(business.stage === 'MINT' && proof.receipt.consumption
          && JSON.stringify(indices) === JSON.stringify(record.plan.step.chunk.mintIndices), 'Collection mint receipt mismatch.')
        minted.push(...indices); consumed.push(...proof.receipt.consumption.indices); mintPackets++
        if (record.plan.step.chunk.includePublicFiles) publicPackets++
      }
    }
    if (pending?.status === 'SUCCEEDED') continue
    minted.sort((a, b) => a - b); consumed.sort((a, b) => a - b)
    check(minted.every((index, i) => index === i) && new Set(consumed).size === consumed.length,
      'Collection completed rows are duplicated or out of order.')
    params.progress(minted.length, request.mints.length)
    if (pending) return { result: null, pending }
    check(registration?.collection, 'The original Collection registration is not proved.')
    const complete = minted.length === request.mints.length && consumed.length === p.preparation.manifest.files.length
      && consumed.every((index, i) => index === i)
    if (complete) return { pending: null, result: { txDigest: head.packet.digest,
      collectionOnChainId: registration.collection.collectionId, rightOnChainId: registration.collection.rightId,
      listingStatus: registration.collection.listingId ? 'listed' : 'unlisted', soulCount: minted.length,
      currentSoulSupply: minted.length, maxSoulSupply: request.collection.maxSupply } }
    if (params.queryOnly) return { result: null, pending: null }
    check(minted.length < request.mints.length || !mintPackets, 'Collection file coverage is incomplete.')
    check(publicPackets === (mintPackets ? 1 : 0), 'Collection public files were omitted or repeated.')
    const mintIndices = Array.from({ length: Math.min(10, request.mints.length - minted.length) }, (_, i) => minted.length + i)
    const outcome = await execution.run({ kind: 'MINT', chunk: { mintIndices, includePublicFiles: !mintPackets,
      collectionObjectId: registration.collection.collectionId, kiosk: await params.resolveKiosk() } },
    { startNew: true, expectedPacket: selected(head) })
    if (outcome.status !== 'SUCCEEDED') return { result: null, pending: outcome }
  }
  throw new Error('Collection progression did not converge. Its saved operation is retained.')
}
