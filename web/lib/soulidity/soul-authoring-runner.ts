import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, soulAuthoringPacketKey,
  type SoulAuthoringStep, type SoulAuthoringPacketPlan, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import type { SoulAuthoringPacketJournal } from './soul-authoring-journal'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation } from './soul-authoring-store'
import { runPublicMutation, publicMutationCanonical as canonical,
  type PublicMutationAdapter, type PublicMutationQuery } from '../sui/public-mutation-journal'
import { assertWalrusBatchLifetime, walrusBatchStep, type WalrusBatchLifetime } from '../upload/walrus-batch-preparation'

export type SoulAuthoringPacketAdapter<Q extends PublicMutationQuery = PublicMutationQuery> =
  PublicMutationAdapter<SoulAuthoringPacketPlan, SoulAuthoringPacketRecord, Q>
export function soulAuthoringPlan(preparation: SoulAuthoringPreparation, step: SoulAuthoringStep): SoulAuthoringPacketPlan {
  const d = createSoulAuthoringPacketParser(preparation)
  return d.plan({ parentKey: d.parentKey, manifestHash: d.manifestHash, step })
}
/** One exact parent packet at a time. Domain adapter.query MUST prove the full
 * historical business receipt; a network success/digest alone is insufficient.
 * preflight MUST validate the entire frozen PTB, gas/authority and uploader state.
 * This coordinator does not supply a permissive/default chain adapter. */
export async function runSoulAuthoringPacket<Q extends PublicMutationQuery>(params: {
  preparation: SoulAuthoringPreparation; step: SoulAuthoringStep
  store: SoulAuthoringPacketJournal; adapter: SoulAuthoringPacketAdapter<Q>; lifetime: WalrusBatchLifetime
  queryOnly?: boolean; cancelUnsigned?: boolean; startNew?: boolean; retireExpired?: boolean; expectedPacket?: { bytes: string; digest: string }
}): Promise<Q & { record: SoulAuthoringPacketRecord }> {
  const preparation = parseSoulAuthoringPreparation(params.preparation), life = { ...params.lifetime }
  const d = createSoulAuthoringPacketParser(preparation), plan = d.plan({ parentKey: d.parentKey, manifestHash: d.manifestHash, step: params.step })
  const scope = preparation.preparation.manifest.scope, store = params.store, adapter = { ...params.adapter }
  check(['prepare', 'query', 'preflight', 'sign', 'verifySignature', 'broadcast']
    .every(name => typeof adapter[name as keyof typeof adapter] === 'function'), 'PRODUCTION_ADAPTER_REQUIRED')
  const step = <T>(run: () => Promise<T> | T) => walrusBatchStep(scope, life, run)
  // Never release the parent lock while an IDB write can still commit. Network
  // timeouts are safe only because their pending packet remains durable.
  async function durable<T>(run: () => Promise<T>) {
    assertWalrusBatchLifetime(scope, life)
    const value = await run(); assertWalrusBatchLifetime(scope, life); return value
  }
  const proofCache = new Map<string, Q>()
  async function query(record: SoulAuthoringPacketRecord) {
    const result = await step(() => adapter.query(structuredClone(record)))
    check(result && ['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(result.status), 'QUERY_INVALID')
    if (['SUCCEEDED', 'FAILED'].includes(result.status)) {
      check(typeof result.checkpoint === 'string' && /^(0|[1-9][0-9]*)$/.test(result.checkpoint), 'CHECKPOINT_REQUIRED')
      proofCache.set(record.packet.digest, structuredClone(result))
    }
    return result
  }
  async function progress(next: SoulAuthoringPacketPlan) {
    const key = soulAuthoringPacketKey(next), history = (await durable(() => store.history(key))).map(d.parse)
    const head = await durable(() => store.read(key))
    if (head) history.push(d.parse(head))
    check(history.length <= 2049 && new Set(history.map(r => r.packet.digest)).size === history.length, 'HISTORY_ALIAS_OR_BUDGET')
    const successful: SoulAuthoringPacketRecord[] = []
    for (const record of history) {
      if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(record.packet.phase)) {
        check(head?.packet.digest === record.packet.digest && canonical(record.plan) === canonical(next), 'UNRESOLVED_STAGE')
        continue
      }
      const proof = proofCache.get(record.packet.digest) ?? await query(record)
      check(proof.status === (['CANCELLED', 'RETIRED'].includes(record.packet.phase) ? 'MISSING' : record.packet.phase), 'HISTORY_UNCONFIRMED')
      if (proof.status === 'SUCCEEDED') successful.push(record)
    }
    const registrations = successful.filter(r => r.plan.step.kind === 'REGISTER')
    const chunks = successful.flatMap(r => r.plan.step.kind === 'MINT' ? [r.plan.step.chunk] : [])
    if (next.step.kind === 'REGISTER') {
      check(successful.length === 0, 'REGISTER_ALREADY_COMPLETED'); return
    }
    check(registrations.length === 1, 'REGISTER_PROOF_REQUIRED')
    const indices = chunks.flatMap(c => c.mintIndices).sort((a, b) => a - b)
    check(indices.every((value, index) => value === index), 'COMPLETED_CHUNKS_INVALID')
    check(next.step.chunk.mintIndices.every((value, index) => value === indices.length + index), 'MINT_ALREADY_COMPLETED_OR_OUT_OF_ORDER')
    if (preparation.preparation.manifest.files.some(f => f.uploadType === 'public')) {
      check(chunks.filter(c => c.includePublicFiles).length === (chunks.length ? 1 : 0)
        && next.step.chunk.includePublicFiles === (chunks.length === 0), 'PUBLIC_FILES_ALREADY_CONSUMED_OR_OMITTED')
    }
  }
  return runPublicMutation({ plan, queryOnly: params.queryOnly, cancelUnsigned: params.cancelUnsigned,
    startNew: params.startNew, retireExpired: params.retireExpired, expectedPacket: params.expectedPacket,
    store: {
      exclusive: (key, work) => store.exclusive(key, () => durable(work)),
      read: key => durable(() => store.read(key)), write: (key, record) => durable(() => store.write(key, record)),
    },
    adapter: {
      // Preparation may persist uploader certificates. Keep the parent lock
      // until all such writes settle; adapter network steps have own deadlines.
      prepare: async next => { await progress(next); return d.parse(await durable(() => adapter.prepare(structuredClone(next)))) },
      query,
      retire: adapter.retire ? record => durable(() => adapter.retire!(structuredClone(record))) : undefined,
      preflight: async (record, signing) => { await progress(record.plan); await step(() => adapter.preflight(structuredClone(record), signing)) },
      // These adapters can perform several bounded preflight/approval steps
      // before the external action. An outer race must not unlock while that
      // continuation can still open a wallet or broadcast later.
      sign: record => durable(() => adapter.sign(structuredClone(record))),
      verifySignature: record => step(() => adapter.verifySignature(structuredClone(record))),
      broadcast: record => durable(() => adapter.broadcast(structuredClone(record))),
    },
  }, { parse: d.parse, key: soulAuthoringPacketKey, errorPrefix: 'SOUL_AUTHORING_PACKET' })
}
