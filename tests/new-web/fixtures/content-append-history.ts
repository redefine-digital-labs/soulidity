import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { SoulStatePublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs,
  SoulDetailStateBcs as D, ProfileWalrusBlobBcs } from '@soulidity/sdk'
import { contentAppendOperationFixture } from './content-append-operation'
import { contentAppendAttachment, contentAppendWalrusIntent } from '../../../web/lib/soulidity/content-append-operation'
import { contentEnvelopeKey } from '../../../web/lib/soulidity/content-envelope'
import { parseWalrusSingleRecord } from '../../../web/lib/upload/walrus-single-operation'
import { readContentAppendHistoricalOutputs } from '../../../web/lib/soulidity/content-append-history'

export const historyId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const prior = toBase58(new Uint8Array(32).fill(7))
const A = bcs.Address, S = bcs.string(), V = bcs.vector(bcs.u8())
const BlobKey = bcs.struct('ContentBlobKey', { kind: bcs.u32(), name: S, version_index: bcs.u64() })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
const fieldCodec = (key: any, value: any) => bcs.struct('Field', { id: A, name: key, value })
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }

/** Real preparation crypto, author stamp and signed canonical attachment Sui
 * packets; full Object BCS/digests and effects are controlled domain fixtures.
 * The domain's caller-proved-effects precondition is injected here: these
 * packets omit the Walrus certify graph and do not prove quorum, checkpoints,
 * Move execution or wallet acceptance. */
export async function contentAppendHistoryFixture(options: Parameters<typeof contentAppendOperationFixture>[0] = {}) {
  const f = await contentAppendOperationFixture(options), r = f.raw, pkg = f.scope.originalPackageId
  const before = structuredClone(r.rows)
  f.finalize()
  const slotKey = { kind: f.scope.kind, name: f.scope.name }
  const identity = { contentObjectId: f.scope.contentObjectId, ...slotKey,
    versionIndex: f.scope.versionIndex, blobObjectId: f.result.blobObjectId }
  const wrapperId = r.field(r.content.id, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
    { name: { ...slotKey, version_index: f.scope.versionIndex } }, '0x2::object::ID', A, f.result.blobObjectId)
  r.rows.set(f.result.blobObjectId, { ...r.rows.get(r.blob.id)!, objectId: f.result.blobObjectId,
    owner: { kind: 2, address: wrapperId }, contents: { value: ProfileWalrusBlobBcs.serialize({ ...r.blob,
      id: f.result.blobObjectId, size: String(f.record.ciphertext.length) }).toBytes() } })
  // Registration pre-exists certification even though this Blob is new to raw.
  before.set(f.result.blobObjectId, { ...r.rows.get(f.result.blobObjectId)!, owner: { kind: 1, address: f.scope.author } })
  async function packet(certify: boolean, rootMutable = true, birth = '1') {
    const tx = new Transaction()
    tx.setSender(f.scope.author); tx.setGasOwner(f.scope.author); tx.setGasBudget(1000000); tx.setGasPrice(1)
    tx.setGasPayment([{ objectId: historyId(90), version: '1', digest: prior }]); tx.setExpiration({ Epoch: 12 })
    if (certify) contentAppendAttachment(f.record).append(tx, f.result.blobObjectId)
    else tx.moveCall({ target: `${historyId(20)}::fixture::register`, arguments: [tx.pure.u8(1)] })
    tx.addBuildPlugin(async (data, _options, next) => {
      data.inputs = data.inputs.map(input => {
        if (!input.UnresolvedObject) return input
        const objectId = input.UnresolvedObject.objectId
        if (objectId === f.result.blobObjectId || objectId === f.intent.grantId)
          return Inputs.ObjectRef({ objectId, version: '11', digest: prior })
        const root = objectId === r.state.id || objectId === r.content.id
        return Inputs.SharedObjectRef({ objectId, initialSharedVersion: root ? birth : '1', mutable: root ? rootMutable : false })
      }); await next()
    })
    const bytes = await tx.build(), signed = await f.crypto.signer.signTransaction(bytes)
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      expirationEpoch: '12', signature: signed.signature, phase: 'SUCCEEDED' as const }
  }
  const payment = parseWalrusSingleRecord({ schema: 'soulidity.walrus-single.v1', intent: contentAppendWalrusIntent(f.record),
    encoding: { blobId: 'offline-blob', rootHash: 'offline-root', nonce: 'offline-nonce', unencodedSize: f.record.ciphertext.length },
    approved: { relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '1000000', quoteId: 'offline-quote' },
    register: await packet(false), certify: await packet(true), acknowledged: false,
    uploaded: { blobId: 'offline-blob', blobObjectId: f.result.blobObjectId, certificate: 'offline-certificate' } })
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: payment.certify!.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '12',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes())
  const ownerFromRow = (row: any) => bcs.Owner.parse(bcs.Owner.serialize(row.owner.kind === 3
    ? { Shared: { initialSharedVersion: String(row.owner.version) } }
    : row.owner.kind === 2 ? { ObjectOwner: row.owner.address } : { AddressOwner: row.owner.address }).toBytes())
  const ids: Record<string, string> = {}, codecs: Record<string, Codec> = {}
  const rows = new Map<string, any>(), objects = new Map<string, ReturnType<typeof bcs.Object.parse>>()
  const change = (label: string) => effects.V2!.changedObjects.find(([id]) => id === ids[label])![1]
  function rehash(label: string) {
    const row = rows.get(ids[label])!, object = objects.get(ids[label])!
    row.bcs.value = bcs.Object.serialize(object).toBytes()
    row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
    change(label).outputState.ObjectWrite![0] = row.digest
  }
  function add(label: string, id: string, codec: Codec) {
    ids[label] = id; codecs[label] = codec
    const raw = structuredClone(r.rows.get(id)!), owner = ownerFromRow(raw), created = !before.has(id)
    const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: {
      type: { Other: TypeTagSerializer.parseFromStr(raw.objectType).struct! }, hasPublicTransfer: false,
      version: '12', contents: raw.contents.value } }, owner,
    previousTransaction: payment.certify!.digest, storageRebate: '0' }).toBytes())
    objects.set(id, object)
    rows.set(id, { ...raw, version: 12n, previousTransaction: payment.certify!.digest, bcs: { value: new Uint8Array() } })
    effects.V2!.changedObjects.push([id, bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
      ...effects.V2!, changedObjects: [[id, { inputState: created ? { NotExist: true } : { Exist: [['11', prior], ownerFromRow(before.get(id)!)] },
        outputState: { ObjectWrite: [prior, owner] }, idOperation: created ? { Created: true } : { None: true } }]],
    } }).toBytes()).V2!.changedObjects[0][1]])
    rehash(label)
  }
  function addField(label: string, parent: string, keyType: string, keyCodec: Codec, key: any, valueCodec: Codec) {
    add(label, deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes()), fieldCodec(keyCodec, valueCodec))
  }
  add('state', r.state.id, SoulStatePublicBcs); add('content', r.content.id, SoulContentPublicBcs)
  addField('slots', r.content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, slotKey, bcs.vector(SoulContentSlotPublicBcs))
  addField('envelope', r.state.config_ext.id, '0x1::string::String', S, contentEnvelopeKey(identity), V)
  add('wrapper', wrapperId, fieldCodec(Wrapper, A)); add('blob', f.result.blobObjectId, ProfileWalrusBlobBcs)
  if (f.intent.spriteConfigJson !== null) addField('sprite', r.state.config_ext.id, '0x1::string::String', S, 'sprite_config_json', V)
  if (f.intent.setActive) addField('active', r.content.active.id, 'u32', bcs.u32(), f.scope.kind, D.Active)
  for (const [index, target] of (f.intent.autoGrantPlan?.targets ?? []).entries()) {
    addField(`grantSlot${index}`, r.state.active_grants.id, 'address', A, target.address, D.GrantSlot)
    addField(`grantReverse${index}`, r.state.active_grant_ids.id, '0x2::object::ID', A, historyId(8000 + index), A)
    add(`grant${index}`, historyId(8000 + index), D.Grant)
  }
  function rewrite(label: string, mutate: (value: any) => void) {
    const object = objects.get(ids[label])!, value = codecs[label].parse(object.data.Move!.contents)
    mutate(value); object.data.Move!.contents = codecs[label].serialize(value).toBytes()
    rows.get(ids[label])!.contents.value = new Uint8Array(object.data.Move!.contents); rehash(label)
  }
  function setOwner(label: string, owner: Parameters<typeof bcs.Owner.serialize>[0], input = false) {
    const parsed = bcs.Owner.parse(bcs.Owner.serialize(owner).toBytes())
    if (input) change(label).inputState.Exist![1] = parsed
    else {
      objects.get(ids[label])!.owner = parsed; change(label).outputState.ObjectWrite![1] = structuredClone(parsed)
      rows.get(ids[label])!.owner = parsed.Shared ? { kind: 3, version: BigInt(parsed.Shared.initialSharedVersion) }
        : { kind: parsed.ObjectOwner ? 2 : 1, address: parsed.ObjectOwner ?? parsed.AddressOwner }
      rehash(label)
    }
  }
  async function replacePacket(rootMutable: boolean, birth = '1') {
    payment.certify = await packet(true, rootMutable, birth)
    effects.V2!.transactionDigest = payment.certify.digest
    for (const [label, objectId] of Object.entries(ids)) {
      objects.get(objectId)!.previousTransaction = payment.certify.digest
      rows.get(objectId)!.previousTransaction = payment.certify.digest
      rehash(label)
    }
  }
  const getObject = vi.fn(async ({ objectId, version }: { objectId: string; version?: bigint }) => {
    if (version !== 12n) throw new Error('Only effects-selected historical versions allowed')
    return { response: { object: structuredClone(rows.get(objectId)) } }
  })
  const forbidden = vi.fn(() => { throw new Error('Current reads and writes forbidden') })
  const client = { ledgerService: { getObject, getEpoch: forbidden },
    core: { getObject: forbidden, getObjects: forbidden, executeTransaction: forbidden }, stateService: { listDynamicFields: forbidden } }
  const params = { record: f.record, payment, effects, client: client as never, signal: f.crypto.controller.signal }
  return { ...f, payment, effects, ids, codecs, rows, objects, change, rehash, rewrite, setOwner, packet, replacePacket, getObject, forbidden,
    historicalClient: client, params, readHistory: () => readContentAppendHistoricalOutputs(params) }
}
