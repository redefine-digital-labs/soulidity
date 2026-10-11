import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { createWalrusBatchHistoryVerifier } from '../upload/walrus-batch-history'
import type { WalrusBatchVerifiers } from '../upload/walrus-batch-adapter'
import { parseWalrusBatchRecord, parseWalrusBatchRegistration, walrusBatchStoreKey,
  type WalrusBatchStore, type WalrusBatchParentPacket, type WalrusBatchRegistrationProof,
  type WalrusBatchConsumptionProof } from '../upload/walrus-batch-store'
import { walrusBatchPreparationHash, walrusBatchCanonicalJson } from '../upload/walrus-batch-preparation'
import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation } from './soul-authoring-store'
import type { SoulAuthoringPacketJournal } from './soul-authoring-journal'
import { createSoulAuthoringTransactionComposer } from './soul-authoring-transaction'
import { proveSoulAuthoringBusinessHistory, type SoulAuthoringBusinessReceipt } from './soul-authoring-history'
import { querySoulAuthoringPacket, type SoulAuthoringFinalTransaction } from './soul-authoring-query'

export interface SoulAuthoringVerifiedReceipt {
  business: SoulAuthoringBusinessReceipt
  registration: WalrusBatchRegistrationProof
  consumption: WalrusBatchConsumptionProof | null
}
/** Read-only production composition. No injected success callback, signing,
 * network write, store mutation or cross-request proof cache. Every recovery
 * re-authenticates registration and consumption from their original bytes. */
export function createSoulAuthoringVerifier(params: {
  client: SuiGrpcClient; preparation: SoulAuthoringPreparation
  journal: Pick<SoulAuthoringPacketJournal, 'read' | 'history'>; uploads: Pick<WalrusBatchStore, 'read'>
}) {
  const p = parseSoulAuthoringPreparation(params.preparation), { client, journal, uploads } = params
  const parser = createSoulAuthoringPacketParser(p), key = `${parser.parentKey}:packets`
  const uploadKey = walrusBatchStoreKey(p.preparation.manifest.scope), preparationHash = walrusBatchPreparationHash(p.preparation)
  const composer = createSoulAuthoringTransactionComposer(p.manifest, p.preparation)
  const same = (a: unknown, b: unknown) => walrusBatchCanonicalJson(a) === walrusBatchCanonicalJson(b)
  async function session(signal: AbortSignal, final?: SoulAuthoringFinalTransaction, registerDigest?: string) {
    signal.throwIfAborted()
    const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
    check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'CHAIN_MISMATCH')
    // Read operations are not mutation locks. If head/archive move between
    // reads, fail closed and retry; never invent a record to fill the gap.
    const archived = await journal.history(key); signal.throwIfAborted()
    const head = await journal.read(key); signal.throwIfAborted()
    const records = [...archived, ...(head ? [head] : [])].map(parser.parse)
    check(records.length <= 2049 && new Set(records.map(r => r.packet.digest)).size === records.length, 'PROOF_HISTORY_ALIAS_OR_BUDGET')
    function find(packet: WalrusBatchParentPacket, stage?: 'REGISTER' | 'MINT') {
      const record = records.find(r => r.packet.digest === packet.digest)
      check(record && record.packet.bytes === packet.bytes && (!stage || record.plan.step.kind === stage), 'DURABLE_PROOF_PACKET_REQUIRED')
      return record
    }
    if (final) {
      const known = find(final.record.packet)
      check(same(known.plan, final.record.plan), 'DURABLE_PROOF_PLAN_MISMATCH')
    }
    const receipts = new Map<string, SoulAuthoringBusinessReceipt>()
    const engine = createWalrusBatchHistoryVerifier({ client, chainIdentifier: p.manifest.request.target.chainIdentifier,
      async verifyParentTransaction(context) {
        signal.throwIfAborted()
        const record = find(context.packet, context.stage === 'register' ? 'REGISTER' : 'MINT')
        check(context.effects.V2 && BigInt(context.effects.V2.executedEpoch) <= BigInt(record.packet.expirationEpoch), 'PROOF_EXECUTED_AFTER_EXPIRY')
        if (final && context.packet.digest === final.record.packet.digest) check(context.checkpoint === final.checkpoint
          && toBase64(bcs.TransactionEffects.serialize(context.effects).toBytes()) === toBase64(bcs.TransactionEffects.serialize(final.effects).toBytes())
          && toBase64(context.events) === toBase64(final.events), 'PROOF_QUERY_CONTRADICTION')
        const registrationReceipt = context.stage === 'consume' && registerDigest ? receipts.get(registerDigest) ?? null : null
        // verifyConsumption invokes its original registration proof first.
        // A stored receipt, phase flag or current Collection cannot substitute.
        if (context.stage === 'consume') check(registrationReceipt, 'REGISTER_BUSINESS_REPROOF_REQUIRED')
        const receipt = await proveSoulAuthoringBusinessHistory({ client, preparation: p, record, context,
          registrationReceipt, signal: context.signal })
        check(!receipts.has(record.packet.digest) || same(receipts.get(record.packet.digest), receipt), 'PROOF_RECEIPT_CONTRADICTION')
        receipts.set(record.packet.digest, receipt)
      } })
    return { engine, find, receipts }
  }
  function preparationMatches(input: Parameters<WalrusBatchVerifiers['verifyRegistration']>[0]['preparation']) {
    check(walrusBatchPreparationHash(input) === preparationHash, 'VERIFIER_PREPARATION_MISMATCH')
  }
  function consumeIndices(record: SoulAuthoringPacketRecord, registration: WalrusBatchRegistrationProof) {
    check(record.plan.step.kind === 'MINT', 'MINT_PACKET_REQUIRED')
    return [...composer.prepareMintBusiness(p.preparation, registration.blobs.map(b => b.objectId), record.plan.step.chunk).fileIndices]
  }
  const verifyRegistration: WalrusBatchVerifiers['verifyRegistration'] = async input => {
    const { signal } = input, captured = structuredClone({ preparation: input.preparation, packet: input.packet })
    preparationMatches(captured.preparation)
    const s = await session(signal); s.find(captured.packet, 'REGISTER')
    return s.engine.verifyRegistration({ preparation: p.preparation, packet: captured.packet, signal })
  }
  const verifyConsumption: WalrusBatchVerifiers['verifyConsumption'] = async input => {
    const { signal } = input, captured = structuredClone({ preparation: input.preparation, packet: input.packet,
      registration: input.registration, indices: input.indices, certificates: input.certificates })
    preparationMatches(captured.preparation)
    const registration = parseWalrusBatchRegistration(captured.registration, p.preparation)
    const s = await session(signal, undefined, registration.packet.digest), record = s.find(captured.packet, 'MINT')
    s.find(registration.packet, 'REGISTER')
    check(same(consumeIndices(record, registration), captured.indices), 'CONSUMPTION_PLAN_INDICES')
    return s.engine.verifyConsumption({ ...captured, preparation: p.preparation, registration, signal })
  }
  async function query(input: SoulAuthoringPacketRecord, signal: AbortSignal) {
    const record = parser.parse(input)
    return querySoulAuthoringPacket<SoulAuthoringVerifiedReceipt>({ client, preparation: p, record, signal,
      async proveSuccess(final) {
        let registration: WalrusBatchRegistrationProof, consumption: WalrusBatchConsumptionProof | null = null
        if (record.plan.step.kind === 'REGISTER') {
          const s = await session(signal, final)
          registration = await s.engine.verifyRegistration({ preparation: p.preparation, packet: {
            bytes: record.packet.bytes, digest: record.packet.digest }, signal })
          const business = s.receipts.get(record.packet.digest); check(business, 'BUSINESS_RECEIPT_REQUIRED')
          return { business, registration, consumption }
        }
        signal.throwIfAborted(); const stored = await uploads.read(uploadKey); signal.throwIfAborted()
        check(stored, 'DURABLE_UPLOAD_REQUIRED')
        const upload = parseWalrusBatchRecord(stored)
        preparationMatches(upload.preparation); check(upload.registration, 'DURABLE_REGISTER_REQUIRED')
        registration = upload.registration
        const s = await session(signal, final, registration.packet.digest)
        s.find(registration.packet, 'REGISTER')
        const indices = consumeIndices(record, registration), certificates = indices.map(index => {
          const certificate = upload.certificates.find(c => c.index === index)
          check(certificate, 'DURABLE_CERTIFICATE_REQUIRED'); return certificate
        })
        consumption = await s.engine.verifyConsumption({ preparation: p.preparation, registration, packet: {
          bytes: record.packet.bytes, digest: record.packet.digest }, indices, certificates, signal })
        const business = s.receipts.get(record.packet.digest); check(business, 'BUSINESS_RECEIPT_REQUIRED')
        return { business, registration, consumption }
      } })
  }
  return { query, verifyRegistration, verifyConsumption }
}
