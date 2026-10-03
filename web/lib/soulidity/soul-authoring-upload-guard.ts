import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase58, toBase64, toHex } from '@mysten/sui/utils'
import type { WalrusClient } from '@mysten/walrus'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { assertWalrusBatchLifetime, walrusBatchCanonicalJson as canonical, walrusBatchPreparationHash,
  type WalrusBatchLifetime } from '../upload/walrus-batch-preparation'
import { parseWalrusBatchRecord, parseWalrusBatchRegistration, validateWalrusBatchIndices, walrusBatchStoreKey, walrusBatchRecordHash,
  type WalrusBatchRegisteredBlob, type WalrusBatchStore } from '../upload/walrus-batch-store'
import type { WalrusBatchVerifiers } from '../upload/walrus-batch-adapter'
import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, soulAuthoringPacketKey } from './soul-authoring-packet'
import { parseSoulAuthoringPreparation, soulAuthoringPreparationHash, type SoulAuthoringPreparation,
  type SoulAuthoringStore } from './soul-authoring-store'
import type { SoulAuthoringPacketJournal } from './soul-authoring-journal'
import { createSoulAuthoringVerifier } from './soul-authoring-verifier'

/** Live upload eligibility, not wallet/mint authority or permission to retire an
 * expired packet. Call under the author lane lock. No writes or permissive proof
 * callbacks: historical success is always re-proved by the production verifier. */
export function createSoulAuthoringUploadGuard(params: {
  client: SuiGrpcClient; walrus: Pick<WalrusClient, 'reset' | 'systemState'>
  preparation: SoulAuthoringPreparation; lifetime: WalrusBatchLifetime
  getTarget: () => SoulAuthoringPreparation['manifest']['request']['target']
  authoring: Pick<SoulAuthoringStore, 'read'>; uploads: Pick<WalrusBatchStore, 'read'>
  journal: Pick<SoulAuthoringPacketJournal, 'read' | 'history'>
}) {
  const p = parseSoulAuthoringPreparation(params.preparation), parser = createSoulAuthoringPacketParser(p)
  const { client, walrus, authoring, uploads, journal, getTarget } = params, life = { ...params.lifetime }
  const scope = p.preparation.manifest.scope, parentHash = soulAuthoringPreparationHash(p)
  const uploadHash = walrusBatchPreparationHash(p.preparation), uploadKey = walrusBatchStoreKey(scope)
  const key = soulAuthoringPacketKey({ parentKey: parser.parentKey, manifestHash: parser.manifestHash,
    step: { kind: 'REGISTER', kiosk: { kind: 'NEW', kioskId: null, capId: null } } })
  const verifier = createSoulAuthoringVerifier({ client, preparation: p, journal, uploads })
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
  function guard(signal: AbortSignal) {
    signal.throwIfAborted(); assertWalrusBatchLifetime(scope, life)
    check(same(getTarget(), p.manifest.request.target), 'RELEASE_CHANGED_QUERY_ONLY')
  }
  const verifyPreparation: WalrusBatchVerifiers['verifyPreparation'] = async input => {
    const { signal } = input
    check(walrusBatchPreparationHash(input.preparation) === uploadHash, 'UPLOAD_PREPARATION_CHANGED')
    guard(signal)
    const saved = await authoring.read(parser.parentKey); guard(signal)
    check(saved && soulAuthoringPreparationHash(saved) === parentHash, 'DURABLE_AUTHORING_CHANGED')
    const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
    check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'CHAIN_MISMATCH'); guard(signal)
  }
  async function snapshot(signal: AbortSignal) {
    guard(signal)
    const history = await journal.history(key); guard(signal)
    const head = await journal.read(key); guard(signal)
    const records = [...history, ...(head ? [head] : [])].map(parser.parse)
    check(records.length <= 2049 && new Set(records.map(r => r.packet.digest)).size === records.length, 'HISTORY_ALIAS_OR_BUDGET')
    return records
  }
  async function read(blob: WalrusBatchRegisteredBlob, signal: AbortSignal, historical = false) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: blob.objectId,
      ...(historical ? { version: BigInt(blob.version) } : {}),
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    guard(signal)
    const row = response.object
    check(row?.objectId === blob.objectId && typeof row.version === 'bigint' && row.version >= BigInt(blob.version)
      && row.version <= 18446744073709551615n && (row.version !== BigInt(blob.version) || row.digest === blob.digest)
      && (!historical || row.version === BigInt(blob.version)),
      'UNCONSUMED_BLOB_REFERENCE_CHANGED')
    const bytes = row.bcs?.value
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 64 * 1024, 'UNCONSUMED_BLOB_BCS_REQUIRED')
    const domain = new TextEncoder().encode('Object::'), preimage = new Uint8Array(domain.length + bytes.length)
    preimage.set(domain); preimage.set(bytes, domain.length)
    const object = bcs.Object.parse(bytes), move = object.data.Move
    check(toBase58(blake2b(preimage, { dkLen: 32 })) === row.digest
      && toBase64(bcs.Object.serialize(object).toBytes()) === toBase64(bytes)
      && move?.version === String(row.version) && `0x${toHex(move.contents.subarray(0, 32))}` === blob.objectId
      && object.owner.AddressOwner === scope.owner && blob.recipient === scope.owner, 'UNCONSUMED_BLOB_BYTES_OR_OWNER_CHANGED')
    return { reference: `${row.version}:${row.digest}`, contents: toBase64(move.contents),
      type: toBase64(bcs.MoveObjectType.serialize(move.type).toBytes()), publicTransfer: move.hasPublicTransfer }
  }
  const beforeBlobWrite: WalrusBatchVerifiers['beforeBlobWrite'] = async input => {
    const { signal } = input, captured = structuredClone({ preparation: input.preparation,
      registration: input.registration, indices: input.indices })
    await verifyPreparation({ preparation: captured.preparation, signal })
    const registration = parseWalrusBatchRegistration(captured.registration, p.preparation)
    const indices = validateWalrusBatchIndices(captured.indices, registration.blobs.length)
    const stored = await uploads.read(uploadKey); guard(signal)
    check(stored, 'DURABLE_UPLOAD_REQUIRED')
    const upload = parseWalrusBatchRecord(stored)
    check(walrusBatchPreparationHash(upload.preparation) === uploadHash && same(upload.registration, registration), 'DURABLE_REGISTER_CHANGED')
    const records = await snapshot(signal), proved = new Set<string>(); let registered = false
    for (const record of records) {
      const result = await verifier.query(record, signal); guard(signal)
      // Even an expired unknown remains query-only here. Its explicit retirement
      // needs separate durable evidence; an epoch/timeout is not a phase flag.
      check(result.status !== 'PENDING' && (result.status !== 'MISSING' || ['CANCELLED', 'RETIRED'].includes(record.packet.phase)),
        'UNRESOLVED_PACKET_QUERY_ONLY')
      if (result.status !== 'SUCCEEDED') continue
      check(same(result.receipt.registration, registration), 'REGISTER_ROOT_CHANGED')
      if (record.plan.step.kind === 'REGISTER') { check(!registered, 'DUPLICATE_REGISTER'); registered = true }
      else {
        const receipt = result.receipt.consumption; check(receipt, 'CONSUMPTION_PROOF_REQUIRED')
        check(!receipt.indices.some(i => indices.includes(i)), 'BLOB_ALREADY_CONSUMED')
        proved.add(receipt.packet.digest)
        check(upload.consumptions.some(saved => same(saved, receipt)), 'CONSUMPTION_ACCEPTANCE_REQUIRED')
      }
    }
    check(registered && upload.consumptions.every(receipt => proved.has(receipt.packet.digest)), 'DURABLE_HISTORY_INCOMPLETE')
    const originals: Awaited<ReturnType<typeof read>>[] = []
    for (const index of indices) originals.push(await read(registration.blobs[index], signal, true))
    async function current() {
      const rows: Awaited<ReturnType<typeof read>>[] = []
      for (const index of indices) rows.push(await read(registration.blobs[index], signal))
      rows.forEach((row, i) => {
        const original = originals[i]
        // Full original contents include the embedded Storage ID/size, which
        // the registration DTO omits, as well as certified_epoch=null.
        check(row.contents === original.contents && row.type === original.type
          && row.publicTransfer === original.publicTransfer, 'UNCONSUMED_BLOB_CONTENT_CHANGED')
      })
      return rows
    }
    const before = await current()
    walrus.reset()
    const state = await profileReadStep(signal, () => walrus.systemState()); guard(signal)
    const epoch = state.committee.epoch
    check(Number.isSafeInteger(epoch) && indices.every(index => {
      const blob = registration.blobs[index]; return epoch >= blob.registeredEpoch && epoch < blob.storageEndEpoch
    }), 'PAID_STORAGE_EXPIRED_OR_WRONG_EPOCH')
    check(same(await current(), before), 'UNCONSUMED_BLOB_CHANGED_RETRY')
    check(same(await snapshot(signal), records), 'PARENT_CHANGED_RETRY')
    const after = await uploads.read(uploadKey); guard(signal)
    check(after && walrusBatchRecordHash(after) === walrusBatchRecordHash(upload), 'UPLOAD_CHANGED_RETRY')
  }
  return { verifyPreparation, beforeBlobWrite }
}
