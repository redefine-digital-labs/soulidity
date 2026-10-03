import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, fromHex, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { SoulStatePublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs,
  SoulDetailStateBcs as D, readSoulDetailState } from '@soulidity/sdk'
import { browserContentAccessFixture } from './browser-content-access-raw'
import type { BrowserContentWriteState } from '../../../web/lib/soulidity/browser-content-write-state'
import { assertContentMutationAuthority, buildContentMutationTransaction, createContentMutationAdapter,
  type ContentMutationPlan, type ContentMutationRecord } from '../../../web/lib/soulidity/content-mutation-transaction'

export const mutationId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const mutationPriorDigest = toBase58(new Uint8Array(32).fill(7))
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type OwnerInput = Parameters<typeof bcs.Owner.serialize>[0]
const A = bcs.Address, N = bcs.u32(), S = bcs.string()
const fieldCodec = (name: any, value: any) => bcs.struct('Field', { id: A, name, value })
const owner = (input: OwnerInput) => bcs.Owner.parse(bcs.Owner.serialize(input).toBytes())

/** Actual SDK transaction resolution/build, local Ed25519 signatures and typed
 * Object BCS/digests. Only transport, object/gas selection and finalized ledger
 * evidence are local fixtures; no live signing, VM, quorum or checkpoint proof. */
export async function contentMutationTransactionFixture(options: {
  action?: ContentMutationPlan['action']; grantee?: boolean; emptyActive?: boolean; ownershipEpoch?: string; memory?: boolean
} = {}) {
  const raw = browserContentAccessFixture(), signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(21))
  const author = signer.toSuiAddress(), oldPkg = raw.deployment.originalPackageId, pkg = mutationId(7001), action = options.action ?? 'delete'
  const kind = options.memory ? 1 : 3, name = options.memory ? 'default' : 'main'
  if (options.memory && (options.grantee || !['delete','purge'].includes(action))) throw Error('Memory fixture supports owner delete/purge only')
  const selectedSlots = options.memory ? [{...raw.slots[0],kind:1,blob_object_id:mutationId(9100),
    op_mask:'7',read_mode_mask:'3',grant_scope_mask:'2',download_policy:0,deleted:action==='purge'}] : raw.slots
  if(options.memory) {
    raw.field(raw.content.items.id,`${oldPkg}::content::ContentKey`,SoulContentKeyPublicBcs,{kind,name},
      `vector<${oldPkg}::content::ContentSlot>`,bcs.vector(SoulContentSlotPublicBcs),selectedSlots)
    raw.content.items.size=String(BigInt(raw.content.items.size)+1n)
    raw.content.count_by_kind.size=String(BigInt(raw.content.count_by_kind.size)+1n)
    raw.field(raw.content.count_by_kind.id,'u32',N,kind,'u64',bcs.u64(),'1')
    raw.field(raw.registry.kinds.id,'u32',N,kind,`${oldPkg}::kind_registry::KindDescriptor`,D.Descriptor,
      {...raw.descriptor,kind,name:'memory',op_mask:'7',read_mode_mask:'3',has_active_binding:false,requires_download_policy:false,default_grant_scope_mask:'2'})
    raw.field(raw.registry.name_to_kind.id,'0x1::string::String',S,'memory','u32',N,kind)
    raw.putContent()
  }
  if (options.grantee) {
    const old = raw.tables.get(raw.state.active_grants.id)![0].fieldId
    raw.rows.delete(old); raw.tables.set(raw.state.active_grants.id, [])
    raw.grantSlot.grantee = author; raw.grant.grantee = author
    raw.field(raw.state.active_grants.id, 'address', A, author, `${oldPkg}::soul::ActiveGrantSlot`, D.GrantSlot, raw.grantSlot)
    raw.field(raw.state.active_grant_ids.id, '0x2::object::ID', A, raw.grant.id, 'address', A, author)
    raw.putGrant({ kind: 1, address: author })
  } else { raw.state.current_owner = author; raw.grant.issued_by = author; raw.putGrant() }
  if (options.ownershipEpoch !== undefined) {
    raw.state.ownership_epoch = options.ownershipEpoch; raw.state.active_grant_count = '0'
  }
  raw.putState()
  if (action === 'purge' && !options.memory) { raw.slots[0].deleted = true; raw.putSlots() }
  if (options.emptyActive) {
    for (const field of raw.tables.get(raw.content.active.id) ?? []) raw.rows.delete(field.fieldId)
    raw.tables.set(raw.content.active.id, []); raw.content.active.size = '0'; raw.putContent()
  }
  // The reused legacy fixture calls the package 0x6, which aliases Clock and is
  // correctly rejected by the transaction parser. Re-derive its entire typed
  // domain under a distinct package; do not weaken the production alias check.
  const translatedType = (value: string) => value.replaceAll(`${oldPkg}::`, `${pkg}::`)
  function domain() {
    const rows = structuredClone(raw.rows), tables = structuredClone(raw.tables)
    for (const row of rows.values()) if (row.objectType) row.objectType = translatedType(row.objectType)
    for (const [parent, fields] of tables) for (const field of fields) {
      const priorId = field.fieldId
      field.name.name = translatedType(field.name.name); field.valueType = translatedType(field.valueType)
      field.fieldId = deriveDynamicFieldID(parent, field.name.name, field.name.value)
      const row = rows.get(priorId)
      if (row) {
        rows.delete(priorId); row.objectId = field.fieldId; row.contents.value.set(fromHex(field.fieldId), 0)
        rows.set(field.fieldId, row)
      }
    }
    return { rows, tables }
  }
  const domainClient = { core: raw.client.core,
    ledgerService: {
      getObject: vi.fn(async ({ objectId }: { objectId: string }) => ({ response: { object: domain().rows.get(objectId) } })),
      batchGetObjects: vi.fn(async ({ requests }: { requests: { objectId: string }[] }) => {
        const rows = domain().rows
        return { response: { objects: requests.map(({ objectId }) => ({ result: rows.has(objectId)
          ? { oneofKind: 'object', object: rows.get(objectId) } : { oneofKind: 'error', error: { code: 5 } } })) } }
      }),
    }, stateService: { listDynamicFields: vi.fn(async ({ parent }: { parent: string }) => ({ response: { dynamicFields: domain().tables.get(parent) ?? [] } })) } }
  const read = async (): Promise<BrowserContentWriteState> => ({ snapshot: await readSoulDetailState({ client: domainClient as never,
    deployment: { ...raw.deployment, originalPackageId: pkg }, stateId: raw.state.id,
    expectedState: { version: String(raw.rows.get(raw.state.id).version), digest: raw.rows.get(raw.state.id).digest },
    viewerAddresses: [author], kindIds: [kind] }), soulId: raw.soul.id, stateId: raw.state.id, contentId: raw.content.id,
    originalPackageId: pkg, callablePackageId: raw.config.target.soulidityCallablePackageId, kindRegistryId: raw.registry.id })
  const proof = await read()
  const plan: ContentMutationPlan = { deployment: { chainIdentifier: raw.deployment.chainIdentifier, originalPackageId: pkg,
    callablePackageId: raw.config.target.soulidityCallablePackageId, marketConfigId: mutationId(7000), kindRegistryId: raw.registry.id },
    soulId: raw.soul.id, stateId: raw.state.id, contentId: raw.content.id, author, ownershipEpoch: raw.state.ownership_epoch, kind, action,
    target: action === 'clear-active' ? null : { name, versionIndex: '0' },
    expectedActive: options.memory || options.emptyActive ? null : { name: raw.active.name, versionIndex: raw.active.version_index },
    grantId: options.grantee ? raw.grant.id : null,
    expectedSlot: action === 'clear-active' ? null : SoulContentSlotPublicBcs.serialize(selectedSlots[0]).toBase64() }
  const resolve = vi.fn(async (data: TransactionDataBuilder, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map(input => {
      if (!input.UnresolvedObject) return input
      const objectId = input.UnresolvedObject.objectId
      return objectId === plan.grantId ? Inputs.ObjectRef({ objectId, version: '11', digest: mutationPriorDigest })
        : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: objectId === plan.contentId })
    })
    data.gasData = { owner: plan.author, budget: '1000000', price: '1',
      payment: [{ objectId: mutationId(9000), version: '11', digest: mutationPriorDigest }] }
    await next()
  })
  vi.spyOn(raw.client.core, 'resolveTransactionPlugin').mockReturnValue(resolve)
  const attributes = { max_tx_size_bytes: '131072', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384' }
  const protocol = vi.spyOn(raw.client.core, 'getProtocolConfig').mockResolvedValue({ protocolConfig: { attributes } } as never)
  const epoch = vi.spyOn(raw.client.ledgerService, 'getEpoch').mockResolvedValue({ response: { epoch: { epoch: 9n } } } as never)
  const simulate = vi.spyOn(raw.client.transactionExecutionService, 'simulateTransaction').mockImplementation((async (input: any) => ({ response: {
    transaction: { transaction: { bcs: { value: new Uint8Array(input.transaction.bcs.value) } }, effects: { status: { success: true } } },
  } })) as never)
  let address: string | null = author
  const getAddress = vi.fn(() => address)
  const sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const preflight = vi.fn(async (input: ContentMutationPlan, _signing: boolean) => assertContentMutationAuthority(input, await read()))
  raw.execute.mockResolvedValue({} as never)
  const adapter = createContentMutationAdapter({ client: raw.client, getAddress, sign, preflight })

  async function packet(input = plan, mutate?: (data: TransactionDataBuilder) => void): Promise<ContentMutationRecord> {
    const tx = buildContentMutationTransaction(input)
    tx.setSender(input.author); tx.setExpiration({ Epoch: '10' })
    const built = await tx.build({ client: raw.client }), data = new TransactionDataBuilder(Transaction.from(built).getData())
    mutate?.(data)
    const bytes = data.build(), signed = await signer.signTransaction(bytes)
    return { schema: 'soulidity.content-mutation.v1', plan: structuredClone(input), packet: { bytes: toBase64(bytes),
      digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'SIGNED', signature: signed.signature } }
  }
  const record = await packet()
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: record.packet.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '12',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes())
  const rows = new Map<string, any>(), objects = new Map<string, ReturnType<typeof bcs.Object.parse>>()
  const ids: Record<string, string> = {}, codecs: Record<string, Codec> = {}
  const change = (label: string) => effects.V2!.changedObjects.find(([objectId]) => objectId === ids[label])![1]
  function rehash(label: string) {
    const row = rows.get(ids[label])!, object = objects.get(ids[label])!
    row.bcs.value = bcs.Object.serialize(object).toBytes()
    row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
    if (label === 'state') effects.V2!.unchangedConsensusObjects.find(([objectId]) => objectId === ids[label])![1].ReadOnlyRoot![1] = row.digest
    else change(label).outputState.ObjectWrite![0] = row.digest
  }
  function add(label: string, objectId: string, type: string, codec: Codec, value: any, inputOwner: OwnerInput, created = false) {
    ids[label] = objectId; codecs[label] = codec
    const readonly = label === 'state', version = readonly ? '11' : '12', previousTransaction = readonly ? mutationPriorDigest : record.packet.digest
    const o = owner(inputOwner), contents = codec.serialize(value).toBytes()
    const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: {
      type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: false, version, contents } },
      owner: o, previousTransaction, storageRebate: '0' }).toBytes())
    objects.set(objectId, object)
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: BigInt(version), previousTransaction,
      owner: o.Shared ? { kind: 3, version: BigInt(o.Shared.initialSharedVersion) } : { kind: 2, address: o.ObjectOwner },
      contents: { value: contents }, bcs: { value: new Uint8Array() }, digest: mutationPriorDigest })
    if (readonly) effects.V2!.unchangedConsensusObjects.push([objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: [version, mutationPriorDigest] }])
    else effects.V2!.changedObjects.push([objectId, { inputState: created ? { $kind: 'NotExist', NotExist: true }
      : { $kind: 'Exist', Exist: [['11', mutationPriorDigest], o] }, outputState: { $kind: 'ObjectWrite', ObjectWrite: [mutationPriorDigest, o] },
      idOperation: created ? { $kind: 'Created', Created: true } : { $kind: 'None', None: true } }])
    rehash(label)
  }
  function addField(label: string, parent: string, keyType: string, keyCodec: Codec, key: any, valueType: string, valueCodec: Codec, value: any, created = false) {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes())
    add(label, objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, fieldCodec(keyCodec, valueCodec),
      { id: objectId, name: key, value }, { ObjectOwner: parent }, created)
  }
  function deleted(label: string, objectId: string, parent: string) {
    ids[label] = objectId
    effects.V2!.changedObjects.push([objectId, { inputState: { $kind: 'Exist', Exist: [['11', mutationPriorDigest], owner({ ObjectOwner: parent })] },
      outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Deleted', Deleted: true } }])
  }
  const content = structuredClone(raw.content)
  if (action === 'clear-active') content.active.size = '0'
  if (action === 'set-active' && options.emptyActive) content.active.size = '1'
  add('state', raw.state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs, raw.state, { Shared: { initialSharedVersion: '1' } })
  add('content', raw.content.id, `${pkg}::content::SoulContent`, SoulContentPublicBcs, content, { Shared: { initialSharedVersion: '1' } })
  if (action === 'delete' || action === 'purge') {
    const slots = structuredClone(selectedSlots); slots[0].deleted = true; slots[0].purged = action === 'purge'
    addField('slots', content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind, name },
      `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), slots)
    if (action === 'purge') {
      const key = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: bcs.u64() })
      const wrapper = deriveDynamicFieldID(content.id, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`,
        bcs.struct('Wrapper', { name: key }).serialize({ name: { kind, name, version_index: '0' } }).toBytes())
      deleted('wrapper', wrapper, content.id); deleted('blob', selectedSlots[0].blob_object_id, wrapper)
    }
  } else if (action === 'set-active') {
    addField('active', content.active.id, 'u32', N, 3, `${pkg}::content::ActiveBinding`, D.Active,
      { ...raw.active, version_index: '0' }, options.emptyActive)
  } else deleted('active', deriveDynamicFieldID(content.active.id, 'u32', N.serialize(3).toBytes()), content.active.id)

  function rewrite(label: string, mutate: (value: any) => void) {
    const object = objects.get(ids[label])!, value = codecs[label].parse(object.data.Move!.contents)
    mutate(value); object.data.Move!.contents = codecs[label].serialize(value).toBytes()
    rows.get(ids[label])!.contents.value = new Uint8Array(object.data.Move!.contents); rehash(label)
  }
  function setOwner(label: string, value: OwnerInput, input = false) {
    const o = owner(value)
    if (input) change(label).inputState.Exist![1] = o
    else {
      objects.get(ids[label])!.owner = o
      if (label !== 'state') change(label).outputState.ObjectWrite![1] = structuredClone(o)
      rows.get(ids[label])!.owner = o.Shared ? { kind: 3, version: BigInt(o.Shared.initialSharedVersion) }
        : o.ObjectOwner ? { kind: 2, address: o.ObjectOwner } : { kind: 1, address: o.AddressOwner }
      rehash(label)
    }
  }
  let checkpoint: bigint | undefined = 42n
  let responseMutation: ((value: any) => void) | null = null
  const getTransaction = vi.spyOn(raw.client.ledgerService, 'getTransaction').mockImplementation((async () => {
    const value = { digest: record.packet.digest, transaction: { digest: record.packet.digest, bcs: { value: fromBase64(record.packet.bytes) } },
      effects: { transactionDigest: record.packet.digest, status: { success: effects.V2!.status.$kind === 'Success' },
        bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() } }, ...(checkpoint === undefined ? {} : { checkpoint }) }
    responseMutation?.(value); return { response: { transaction: value } }
  }) as never)
  const liveGet = raw.get.getMockImplementation()!
  raw.get.mockImplementation((async (request: { objectId: string; version?: bigint }, ...args: any[]) => {
    if (request.version !== undefined) {
      const row = rows.get(request.objectId)
      if (!row || request.version !== row.version) throw new Error('Only exact effects-selected historical versions are available')
      return { response: { object: structuredClone(row) } }
    }
    return Reflect.apply(liveGet, raw.client.ledgerService, [request, ...args])
  }) as never)
  return { raw, signer, author, plan, record, proof, read, adapter, resolve, sign, preflight, getAddress, protocol, epoch, simulate,
    getTransaction, attributes, effects, rows, objects, ids, codecs, change, rehash, rewrite, setOwner, packet, domain,
    setAddress: (value: string | null) => { address = value }, setCheckpoint: (value: bigint | undefined) => { checkpoint = value },
    mutateResponse: (callback: (value: any) => void) => { responseMutation = callback } }
}
