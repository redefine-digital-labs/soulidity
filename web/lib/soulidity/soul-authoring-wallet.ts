import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { createWalrusBatchAdapter, type WalrusBatchClient } from '../upload/walrus-batch-adapter'
import { assertWalrusBatchLifetime, walrusBatchPreparationHash, type WalrusBatchLifetime } from '../upload/walrus-batch-preparation'
import { parseWalrusBatchRecord, walrusBatchStoreKey, type WalrusBatchStore } from '../upload/walrus-batch-store'
import { createSoulAuthoringUploadGuard } from './soul-authoring-upload-guard'
import { createSoulAuthoringVerifier } from './soul-authoring-verifier'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation, type SoulAuthoringStore } from './soul-authoring-store'
import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, soulAuthoringPacketKey,
  type SoulAuthoringPacketRecord, type SoulAuthoringPacketPlan, type SoulAuthoringStep } from './soul-authoring-packet'
import { createSoulAuthoringTransactionComposer, buildSoulAuthoringRegistrationTransaction,
  buildSoulAuthoringMintTransaction } from './soul-authoring-transaction'
import { runSoulAuthoringPacket, type SoulAuthoringPacketAdapter } from './soul-authoring-runner'
import type { SoulAuthoringPacketJournal } from './soul-authoring-journal'
import { resolveSoulAuthoringFunding } from './soul-authoring-funding'
import { readSoulAuthoringExpiry } from './soul-authoring-expiry'
import { verifySoulAuthoringSources } from './soul-authoring-source'

/** Browser transport composition. The wallet approves/signs exact persisted
 * bytes; no injected proof/preflight/success bypass. `run` is the mutation entry
 * point and holds the parent lock through construction (including node writes).
 * Queries never require a connected wallet or mutate local storage. */
export function createSoulAuthoringWallet(params: {
  client: SuiGrpcClient; walrus: WalrusBatchClient; preparation: SoulAuthoringPreparation
  lifetime: WalrusBatchLifetime; getTarget: () => SoulAuthoringPreparation['manifest']['request']['target']
  authoring: Pick<SoulAuthoringStore, 'read'>; uploads: WalrusBatchStore; journal: SoulAuthoringPacketJournal
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  /** Display the exact whole packet, including storage payments and maximum gas,
   * before a wallet prompt. Decline retains its unsigned recoverable packet. */
  approve: (record: SoulAuthoringPacketRecord) => Promise<boolean>
}) {
  const p = parseSoulAuthoringPreparation(params.preparation), parser = createSoulAuthoringPacketParser(p)
  const { client, walrus, uploads, journal, sign, approve } = params, life = { ...params.lifetime }
  const scope = p.preparation.manifest.scope, uploadKey = walrusBatchStoreKey(scope)
  check(typeof sign === 'function' && typeof approve === 'function', 'WALLET_APPROVAL_REQUIRED')
  const verifier = createSoulAuthoringVerifier({ client, preparation: p, journal, uploads })
  const live = createSoulAuthoringUploadGuard({ ...params, preparation: p, lifetime: life })
  const uploader = createWalrusBatchAdapter({ preparation: p.preparation, client: walrus, store: uploads,
    lifetime: life, verifiers: { ...verifier, ...live } })
  const composer = createSoulAuthoringTransactionComposer(p.manifest, p.preparation)
  const guard = () => assertWalrusBatchLifetime(scope, life)
  const signal = () => AbortSignal.any([life.signal, AbortSignal.timeout(30000)])
  async function upload() {
    const stored = await uploads.read(uploadKey); guard(); check(stored, 'DURABLE_UPLOAD_REQUIRED')
    const record = parseWalrusBatchRecord(stored)
    check(walrusBatchPreparationHash(record.preparation) === walrusBatchPreparationHash(p.preparation), 'UPLOAD_PREPARATION_CHANGED')
    return record
  }
  async function epoch(s: AbortSignal) {
    const { response } = await profileReadStep(s, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: s }))
    const value = response.epoch?.epoch
    check(typeof value === 'bigint' && value >= 0n && value < 18446744073709551615n, 'EPOCH_UNAVAILABLE')
    return value
  }
  async function ready(record?: SoulAuthoringPacketRecord) {
    guard(); const s = signal()
    await live.verifyPreparation({ preparation: p.preparation, signal: s })
    await verifySoulAuthoringSources(client, p.manifest.request, s)
    const now = await epoch(s)
    if (record) check(now <= BigInt(record.packet.expirationEpoch)
      && BigInt(record.packet.expirationEpoch) <= now + 1n, 'EXPIRED_OR_FUTURE_PACKET_QUERY_ONLY')
    guard(); return now
  }
  async function registration(record: Awaited<ReturnType<typeof upload>>) {
    check(record.registration, 'DURABLE_REGISTER_REQUIRED')
    const proof = await verifier.verifyRegistration({ preparation: p.preparation,
      packet: record.registration.packet, signal: signal() })
    check(JSON.stringify(proof) === JSON.stringify(record.registration), 'DURABLE_REGISTER_CHANGED')
    return proof
  }
  /** Reconstruct the complete graph without node writes. Never take the
   * candidate's suffix, excluded command indices or cached success on trust. */
  async function template(plan: SoulAuthoringPacketPlan) {
    const tx = new Transaction(); tx.setSender(scope.owner); walrus.reset()
    if (plan.step.kind === 'REGISTER') {
      check((await upload()).registration === null, 'REGISTER_ALREADY_ACCEPTED')
      const blobs = p.preparation.manifest.files.map(file => tx.add(walrus.registerBlob({ size: file.payloadByteLength,
        epochs: p.preparation.manifest.storageEpochs, blobId: file.encoding.blobId, rootHash: fromBase64(file.encoding.rootHash), deletable: true })))
      p.preparation.manifest.files.forEach(file => tx.transferObjects([blobs[file.index]], file.recipient))
      await profileReadStep(signal(), () => tx.prepareForSerialization({ supportedIntents: ['CoinWithBalance'] }))
      composer.appendRegistrationBusiness(tx, plan.step.kiosk)
    } else {
      const stored = await upload(), proof = await registration(stored)
      const stage = composer.prepareMintBusiness(p.preparation, proof.blobs.map(blob => blob.objectId), plan.step.chunk)
      check(!stored.consumptions.some(receipt => receipt.indices.some(i => stage.fileIndices.includes(i))), 'BLOB_ALREADY_CONSUMED')
      for (const index of stage.fileIndices) {
        const certificate = stored.certificates.find(row => row.index === index)
        check(certificate, 'DURABLE_CERTIFICATE_REQUIRED')
        tx.add(walrus.certifyBlob({ blobId: p.preparation.manifest.files[index].encoding.blobId,
          blobObjectId: proof.blobs[index].objectId, certificate: certificate.certificate, deletable: true }))
      }
      await profileReadStep(signal(), () => tx.prepareForSerialization({ supportedIntents: ['CoinWithBalance'] }))
      stage.append(tx)
    }
    return tx
  }
  async function preflight(input: SoulAuthoringPacketRecord) {
    const record = parser.parse(input); await ready(record)
    const bytes = fromBase64(record.packet.bytes), data = Transaction.from(bytes).getData()
    const expected = await template(record.plan)
    await resolveSoulAuthoringFunding({ expected, candidate: Transaction.from(bytes), client, author: scope.owner, signal: signal() })
    // Freeze ABI-owned refs only for independently expected object IDs. SDK
    // still determines shared/owned/Receiving semantics from actual Move ABI.
    const refs = new Map(data.inputs.flatMap(i => i.Object?.ImmOrOwnedObject
      ? [[i.Object.ImmOrOwnedObject.objectId, i.Object.ImmOrOwnedObject] as const] : []))
    expected.addSerializationPlugin(async (builder, _options, next) => {
      for (const input of builder.inputs) if (input.UnresolvedObject) {
        const ref = refs.get(input.UnresolvedObject.objectId)
        if (ref) Object.assign(input.UnresolvedObject, { version: ref.version, digest: ref.digest })
      }
      await next()
    })
    const kind = await profileReadStep(signal(), () => expected.build({ client, onlyTransactionKind: true }))
    check(toBase64(kind) === toBase64(bcs.TransactionKind.serialize(bcs.TransactionData.parse(bytes).V1!.kind).toBytes()), 'WHOLE_TRANSACTION_TEMPLATE_MISMATCH')
    const objectIds = new Set(data.inputs.flatMap(i => {
      const id = i.Object?.ImmOrOwnedObject?.objectId ?? i.Object?.SharedObject?.objectId ?? i.Object?.Receiving?.objectId
      return id ? [id] : []
    }))
    check(data.gasData.payment?.length && new Set(data.gasData.payment.map(c => c.objectId)).size === data.gasData.payment.length
      && data.gasData.payment.every(c => !objectIds.has(c.objectId)), 'GAS_INPUT_ALIAS')
    const { protocolConfig } = await profileReadStep(signal(), () => client.core.getProtocolConfig())
    const limit = (name: string) => { const value = protocolConfig.attributes[name]
      check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value), 'PROTOCOL_LIMIT_UNAVAILABLE'); return BigInt(value) }
    check(BigInt(bytes.length) <= limit('max_tx_size_bytes') && BigInt(data.commands.length) <= limit('max_programmable_tx_commands'), 'PROTOCOL_LIMIT')
    for (const input of data.inputs) if (input.Pure)
      check(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'PURE_ARGUMENT_LIMIT')
    const s = signal(), { response } = await profileReadStep(s, () => client.transactionExecutionService.simulateTransaction({
      transaction: { bcs: { value: bytes } }, checks: 0, doGasSelection: false,
      readMask: { paths: ['transaction.transaction.bcs', 'transaction.effects.status'] },
    }, { abort: s }))
    check(response.transaction?.transaction?.bcs?.value && toBase64(response.transaction.transaction.bcs.value) === record.packet.bytes
      && response.transaction.effects?.status?.success === true, 'EXACT_SIMULATION_REJECTED')
    guard()
  }
  async function verifySignature(input: SoulAuthoringPacketRecord) {
    const record = parser.parse(input); check(record.packet.signature, 'SIGNATURE_REQUIRED')
    await profileReadStep(signal(), () => verifyTransactionSignature(fromBase64(record.packet.bytes), record.packet.signature!, { address: scope.owner, client }))
    guard()
  }
  type Query = Awaited<ReturnType<typeof verifier.query>>
  const adapter: SoulAuthoringPacketAdapter<Query> = {
    async prepare(input) {
      const plan = parser.plan(input), now = await ready(); walrus.reset()
      let tx: Transaction
      if (plan.step.kind === 'REGISTER') tx = await buildSoulAuthoringRegistrationTransaction({
        manifest: p.manifest, preparation: p.preparation, kiosk: plan.step.kiosk, uploader })
      else {
        const stored = await upload(), proof = await registration(stored)
        tx = (await buildSoulAuthoringMintTransaction({ manifest: p.manifest, preparation: p.preparation,
          blobIds: proof.blobs.map(blob => blob.objectId), chunk: plan.step.chunk, uploader })).transaction
      }
      tx.setSender(scope.owner); tx.setGasOwner(scope.owner); tx.setExpiration({ Epoch: String(now + 1n) })
      const bytes = await profileReadStep(signal(), () => tx.build({ client })); guard()
      const record = parser.parse({ schema: 'soulidity.soul-authoring-packet.v1', plan, packet: { bytes: toBase64(bytes),
        digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: String(now + 1n), phase: 'PREPARED', signature: null } })
      await preflight(record); return record
    },
    query: input => verifier.query(parser.parse(input), signal()),
    async retire(input) {
      const record = parser.parse(input)
      check(['PREPARED', 'SIGNING', 'SIGNED', 'RETIRED'].includes(record.packet.phase), 'RETIREMENT_NOT_ALLOWED')
      guard()
      const checkpoint = await readSoulAuthoringExpiry(client, record.packet.expirationEpoch, signal(), record.retirement?.checkpoint)
      const observed = await verifier.query(record, signal()); guard()
      check(observed.status === 'MISSING', 'RETIREMENT_TRANSACTION_FOUND')
      return parser.parse({ ...record, packet: { ...record.packet, phase: 'RETIRED' },
        retirement: record.retirement ?? { priorPhase: record.packet.phase, checkpoint } })
    },
    preflight,
    async sign(input) {
      const record = parser.parse(input)
      check(['PREPARED', 'SIGNING'].includes(record.packet.phase), 'NOT_SIGNABLE')
      await preflight(record)
      // Human review is not an RPC. The owner lifetime cancels the dialog;
      // do not time out, unlock, and leave a live approval request behind.
      check(await approve(structuredClone(record)), 'USER_DECLINED_PACKET')
      // Recheck after the potentially long approval dialog before opening wallet.
      await preflight(record)
      const signed = await sign(Transaction.from(fromBase64(record.packet.bytes)))
      guard(); check(signed.bytes === record.packet.bytes, 'WALLET_CHANGED_BYTES')
      await verifySignature({ ...record, packet: { ...record.packet, phase: 'SIGNED', signature: signed.signature } })
      return signed
    },
    verifySignature,
    async broadcast(input) {
      const record = parser.parse(input); check(record.packet.phase === 'SIGNED', 'NOT_SIGNED')
      await preflight(record); await verifySignature(record); guard()
      await profileReadStep(signal(), () => client.core.executeTransaction({ transaction: fromBase64(record.packet.bytes), signatures: [record.packet.signature!] }))
    },
  }
  async function accept(input: SoulAuthoringPacketRecord) {
    const record = parser.parse(input)
    return journal.exclusive(soulAuthoringPacketKey(record.plan), async () => {
      const result = await adapter.query(record); check(result.status === 'SUCCEEDED', 'FINALITY_REQUIRED')
      // Await durable CAS to settlement, not a network timeout. Re-querying and
      // accepting historical records is idempotent and never signs or broadcasts.
      if (record.plan.step.kind === 'REGISTER') await uploader.acceptRegistration(result.receipt.registration.packet)
      else {
        check(result.receipt.consumption, 'CONSUMPTION_PROOF_REQUIRED')
        await uploader.acceptConsumption(result.receipt.consumption.packet, result.receipt.consumption.indices)
      }
      guard(); return result
    })
  }
  return {
    query: adapter.query, accept,
    async run(step: SoulAuthoringStep, options: { queryOnly?: boolean; cancelUnsigned?: boolean; startNew?: boolean; retireExpired?: boolean;
      expectedPacket?: { bytes: string; digest: string } } = {}) {
      const result = await runSoulAuthoringPacket({ preparation: p, step, store: journal, adapter, lifetime: life, ...options })
      if (result.status === 'SUCCEEDED' && !options.queryOnly) await accept(result.record)
      return result
    },
  }
}
