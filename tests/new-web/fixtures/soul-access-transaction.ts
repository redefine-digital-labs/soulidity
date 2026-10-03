import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { SoulStatePublicBcs, SoulDetailStateBcs as D, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { buildSoulAccessTransaction, createSoulAccessAdapter, createSoulAccessPlan, SoulAccessCoinBcs,
  soulAccessIsGrant, soulAccessUsesMarket, soulAccessPurchaseExpiry, type SoulAccessAction, type SoulAccessState,
  type SoulAccessPlan, type SoulAccessRecord, type SoulAccessRequest } from '../../../web/lib/soulidity/soul-access-operation'

export const accessId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const priorDigest = toBase58(new Uint8Array(32).fill(7)), A = bcs.Address, N = bcs.u32()
const shared = { Shared: { initialSharedVersion: '1' } }, fieldCodec = (key: any, value: any) => bcs.struct('Field', { id: A, name: key, value })
type Owner = Parameters<typeof bcs.Owner.serialize>[0]
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }

export function soulAccessFixtureState(options: { action?: SoulAccessAction; slot?: 'absent' | 'expired' | 'stale';
  entry?: 'absent' | 'expired' | 'stale' | 'lifetime'; buyerSize?: string; duration?: string | null; price?: string; feeBps?: number; paymentBalances?: string[] } = {}) {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(41)), author = signer.toSuiAddress()
  const action = options.action ?? 'grant-issue', isPurchase = action === 'paid-purchase', isGrant = soulAccessIsGrant(action)
  const state = { id: accessId(1002), version: '1', soul_id: accessId(1003), creator: accessId(1004), creator_royalty_bps: 500,
    current_owner: isPurchase ? accessId(1005) : author, current_kiosk_id: accessId(1007), ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: accessId(1008), size: options.slot === 'absent' ? '0' : '1' },
    active_grant_ids: { id: accessId(1009), size: options.slot === 'absent' ? '0' : '1' },
    active_grant_count: options.slot === 'absent' || options.slot === 'stale' ? '0' : '1',
    content_id: accessId(1010), config_ext: { id: accessId(1011), size: '1' }, collection_id: null, access_list_id: accessId(1012), is_listed: false }
  const paid = { id: accessId(1012), version: '1', soul_id: state.soul_id, creator: state.creator,
    kind_configs: { id: accessId(1060), size: action === 'paid-configure' ? '0' : '1' },
    entries: { id: accessId(1061), size: options.entry === 'absent' ? '0' : '1' } }
  const registry = { id: accessId(1030), version: '1', next_kind: 16, kinds: { id: accessId(1031), size: '5' }, name_to_kind: { id: accessId(1032), size: '5' } }
  const descriptor = { version: '1', kind: 3, name: 'sprite', op_mask: '15', read_mode_mask: '15', has_active_binding: true,
    requires_download_policy: true, default_grant_scope_mask: '8', deprecated: false }
  const grantee = isPurchase ? author : accessId(1051)
  const slot = options.slot === 'absent' ? null : { version: '1', grant_id: accessId(1050), grantee, scope_mask: '9',
    expires_at_ms: options.slot === 'expired' ? '999' : '2000', ownership_epoch_snapshot: options.slot === 'stale' ? '1' : '2' }
  const config = action === 'paid-configure' ? null : { version: '1', price_atomic: options.price ?? '10001', scope_mask: '8',
    duration_ms: options.duration === undefined ? '3000' : options.duration, ownership_epoch_snapshot: '2' }
  const entry = options.entry === 'absent' ? null : { version: '1', scope_mask: '8', expires_at_ms: options.entry === 'lifetime' ? null : options.entry === 'expired' ? '999' : '2000',
    ownership_epoch_snapshot: options.entry === 'stale' ? '1' : '2' }
  const table = entry ? { id: accessId(1062), size: options.buyerSize ?? '1' } : null
  const market = { id: accessId(7000), version: '2', legacy_config_id: accessId(7002), fee_recipient: accessId(7003),
    platform_fee_bps: options.feeBps ?? 250, primary_enabled: true, secondary_enabled: true }
  const deployment = { chainIdentifier: '35834a8a', originalPackageId: accessId(7001), callablePackageId: accessId(7004),
    marketConfigId: market.id, kindRegistryId: registry.id, paymentCoinType: SOUL_PUBLIC_USDC_TYPE }
  const observed = { deployment, soulId: state.soul_id, stateId: state.id, contentId: state.content_id, paidAccessListId: paid.id, author,
    stateBcs: SoulStatePublicBcs.serialize(state).toBase64(), paidBcs: D.Paid.serialize(paid).toBase64(), marketConfigBcs: SoulPublicMarketConfigBcs.serialize(market).toBase64(),
    buyerAddress: grantee, buyerTableBcs: table ? D.Table.serialize(table).toBase64() : null, kind: isGrant ? null : 3,
    descriptorBcs: isGrant ? null : D.Descriptor.serialize(descriptor).toBase64(),
    snapshot: { stateId: state.id, soulId: state.soul_id, stateVersion: '11', stateDigest: priorDigest, currentOwner: state.current_owner,
      creator: state.creator, ownershipEpoch: state.ownership_epoch, grantCapacity: state.grant_capacity, activeGrantCount: state.active_grant_count,
      contentId: state.content_id, paidAccessListId: paid.id, observedAtMs: '1000', config: {}, contentVersions: [], activeBindings: [],
      kindDescriptors: [descriptor], grants: slot ? [{ slot }] : [], paidAccessKindConfigs: config ? [{ kind: 3, config }] : [],
      paidAccessEntries: entry ? [{ buyerAddress: grantee, kind: 3, entry }] : [] } } as unknown as SoulAccessState
  const request: SoulAccessRequest = isGrant ? { action, granteeAddress: grantee, ...(action === 'grant-issue' ? { scopeMask: 4, expiresAtMs: '4000' }
    : action === 'grant-revoke-scope' ? { scopeMask: 1 } : {}) }
    : { action, kind: 3, ...(action === 'paid-purchase' ? { renew: entry?.ownership_epoch_snapshot === '2' }
      : action === 'paid-revoke' ? { granteeAddress: grantee }
        : action === 'paid-configure' || action === 'paid-update' ? { priceAtomic: '777', durationMs: options.duration === undefined ? '5000' : options.duration } : {}) }
  return { signer, author, action, state, paid, registry, descriptor, slot, config, entry, table, market, deployment, grantee, observed, request }
}

/** Real SDK PTB build and local Ed25519 signature; only transport and ledger
 * finality are fixtures. All historical input/output digests hash full Objects. */
export async function soulAccessTransactionFixture(options: Parameters<typeof soulAccessFixtureState>[0] = {},
  configure?: (fixture: ReturnType<typeof soulAccessFixtureState>) => Promise<void>) {
  const f = soulAccessFixtureState(options)
  await configure?.(f)
  const { state, paid, deployment: d, signer, author, action } = f, pkg = d.originalPackageId
  const rows = new Map<string, any>(), objects = new Map<string, any>(), codecs = new Map<string, Codec>(), ids: Record<string, string> = {}
  const key = (id: string, version: string | bigint) => `${id}:${version}`
  function full(objectId: string, type: string, codec: Codec, value: any, ownerInput: Owner, version = '11', txDigest = priorDigest) {
    const owner = bcs.Owner.parse(bcs.Owner.serialize(ownerInput).toBytes()), contents = codec.serialize(value).toBytes()
    const compact = type.startsWith('0x2::coin::Coin<') ? { Coin: type.slice('0x2::coin::Coin<'.length, -1) }
      : { Other: TypeTagSerializer.parseFromStr(type).struct! }
    const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: compact, hasPublicTransfer: false, version, contents } },
      owner, previousTransaction: txDigest, storageRebate: '0' }).toBytes())
    const bytes = bcs.Object.serialize(object).toBytes(), digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 }))
    const row = { objectId, objectType: normalizeStructTag(type), version: BigInt(version), digest, previousTransaction: txDigest,
      owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 1, address: owner.AddressOwner },
      contents: { value: contents }, bcs: { value: bytes } }
    rows.set(key(objectId, version), row); objects.set(key(objectId, version), object); codecs.set(key(objectId, version), codec)
    return { row, object, owner }
  }
  const coinInputs = action === 'paid-purchase' ? (options.paymentBalances ?? ['7000', '13000']).map((balance, i) => {
    const id = accessId(8000 + i), input = full(id, `0x2::coin::Coin<${d.paymentCoinType}>`, SoulAccessCoinBcs,
      { id, balance }, { AddressOwner: author })
    return { objectId: id, version: '11', digest: input.row.digest, balance }
  }) : []
  f.request.paymentCoins = coinInputs
  const plan = createSoulAccessPlan({ state: f.observed, request: f.request })
  const gasId = accessId(9000), gas = full(gasId, '0x2::coin::Coin<0x2::sui::SUI>', SoulAccessCoinBcs, { id: gasId, balance: '10000000' }, { AddressOwner: author })
  const resolve = vi.fn(async (data: TransactionDataBuilder, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map(input => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === (soulAccessIsGrant(action) ? state.id : paid.id) }) : input)
    data.gasData = { owner: author, budget: '1000000', price: '1', payment: [{ objectId: gasId, version: '11', digest: gas.row.digest }] }; await next()
  })
  const chainBytes = new Uint8Array(32); chainBytes.set([0x35, 0x83, 0x4a, 0x8a])
  const client = { core: { resolveTransactionPlugin: () => resolve, getChainIdentifier: vi.fn(async () => ({ chainIdentifier: toBase58(chainBytes) })),
    getProtocolConfig: vi.fn(async () => ({ protocolConfig: { attributes: { max_tx_size_bytes: '131072', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384' } } })),
    executeTransaction: vi.fn(async () => ({})) }, ledgerService: { getObject: vi.fn(async ({ objectId, version }: any) => {
      const row = rows.get(key(objectId, version ?? '11')); if (!row) throw new Error('Exact historical object unavailable')
      return { response: { object: structuredClone(row) } }
    }), getEpoch: vi.fn(async () => ({ response: { epoch: { epoch: 9n } } })), getTransaction: vi.fn() },
    transactionExecutionService: { simulateTransaction: vi.fn(async (input: any) => ({ response: { transaction: {
      transaction: { bcs: { value: new Uint8Array(input.transaction.bcs.value) } }, effects: { status: { success: true } } } } })) } }
  async function packet(input = plan, mutate?: (data: TransactionDataBuilder) => void): Promise<SoulAccessRecord> {
    const tx = buildSoulAccessTransaction(input); tx.setSender(author); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build({ client: client as never }), data = new TransactionDataBuilder(Transaction.from(bytes).getData()); mutate?.(data)
    const signedBytes = data.build(), signed = await signer.signTransaction(signedBytes)
    return { schema: 'soulidity.soul-access.v1', plan: structuredClone(input), packet: { bytes: toBase64(signedBytes),
      digest: TransactionDataBuilder.getDigestFromBytes(signedBytes), expirationEpoch: '10', phase: 'SIGNED', signature: signed.signature } }
  }
  const record = await packet()
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '9',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest: record.packet.digest,
    gasObjectIndex: 0, eventsDigest: null, dependencies: [], lamportVersion: '12', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes())
  const change = (label: string) => effects.V2!.changedObjects.find(([id]) => id === ids[label])![1]
  function add(label: string, id: string, type: string, codec: Codec, before: any | null, after: any | null, owner: Owner, readonly = false) {
    ids[label] = id
    const input = before === null ? null : full(id, type, codec, before, owner)
    if (readonly) { effects.V2!.unchangedConsensusObjects.push([id, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['11', input!.row.digest] }]); return }
    // Actual Sui protocol minimizes child writes whose final bytes match.
    if ('ObjectOwner' in owner && before !== null && after !== null
      && toBase64(codec.serialize(before).toBytes()) === toBase64(codec.serialize(after).toBytes())) return
    const output = after === null ? null : full(id, type, codec, after, owner, '12', record.packet.digest)
    effects.V2!.changedObjects.push([id, { inputState: input ? { $kind: 'Exist', Exist: [['11', input.row.digest], input.owner] } : { $kind: 'NotExist', NotExist: true },
      outputState: output ? { $kind: 'ObjectWrite', ObjectWrite: [output.row.digest, output.owner] } : { $kind: 'NotExist', NotExist: true },
      idOperation: !output ? { $kind: 'Deleted', Deleted: true } : !input ? { $kind: 'Created', Created: true } : { $kind: 'None', None: true } }])
  }
  function field(label: string, parent: string, keyType: string, keyCodec: any, name: any, valueType: string, codec: any, before: any | null, after: any | null) {
    const id = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(name).toBytes())
    add(label, id, `0x2::dynamic_field::Field<${keyType},${valueType}>`, fieldCodec(keyCodec, codec),
      before === null ? null : { id, name, value: before }, after === null ? null : { id, name, value: after }, { ObjectOwner: parent })
  }
  add('gas', gasId, '0x2::coin::Coin<0x2::sui::SUI>', SoulAccessCoinBcs, { id: gasId, balance: '10000000' }, { id: gasId, balance: '9999999' }, { AddressOwner: author })
  const nextState = structuredClone(state), nextPaid = structuredClone(paid), nextGrant = accessId(8050)
  if (soulAccessIsGrant(action)) {
    if (f.slot) field('oldReverse', state.active_grant_ids.id, '0x2::object::ID', A, f.slot.grant_id, 'address', A, f.grantee, null)
    const replacing = action !== 'grant-revoke', expiry = action === 'grant-issue' ? plan.input.expiresAtMs : f.slot!.expires_at_ms
    const nextSlot = replacing ? { version: '1', grant_id: nextGrant, grantee: f.grantee, scope_mask: String(plan.quote.scopeMask),
      expires_at_ms: expiry, ownership_epoch_snapshot: '2' } : null
    field('slot', state.active_grants.id, 'address', A, f.grantee, `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot, f.slot, nextSlot)
    if (replacing) {
      add('grant', nextGrant, `${pkg}::grant::SoulGrant`, D.Grant, null, { id: nextGrant, version: '1', soul_id: state.soul_id,
        grantee: f.grantee, issued_by: author, ownership_epoch_snapshot: '2', scope_mask: String(plan.quote.scopeMask), expires_at_ms: expiry }, { AddressOwner: f.grantee })
      field('newReverse', state.active_grant_ids.id, '0x2::object::ID', A, nextGrant, 'address', A, null, f.grantee)
    }
    nextState.active_grants.size = String(BigInt(state.active_grants.size) + (replacing ? f.slot ? 0n : 1n : -1n))
    nextState.active_grant_ids.size = nextState.active_grants.size
    nextState.active_grant_count = String(BigInt(state.active_grant_count) - (f.slot?.ownership_epoch_snapshot === '2' ? 1n : 0n) + (replacing ? 1n : 0n))
    if (action === 'grant-issue') nextState.grant_capacity = plan.quote.capacity!
    add('state', state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs, state, nextState, shared)
  } else {
    add('state', state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs, state, state, shared, true)
    if (['paid-configure', 'paid-update', 'paid-delete'].includes(action)) {
      field('config', paid.kind_configs.id, 'u32', N, 3, `${pkg}::paid_access::KindPaidConfig`, D.PaidConfig, f.config,
        action === 'paid-delete' ? null : { version: '1', price_atomic: plan.input.priceAtomic, scope_mask: '8', duration_ms: plan.input.durationMs, ownership_epoch_snapshot: '2' })
      nextPaid.kind_configs.size = String(BigInt(paid.kind_configs.size) + (action === 'paid-configure' ? 1n : action === 'paid-delete' ? -1n : 0n))
    } else {
      const table = f.table ?? { id: accessId(8062), size: '0' }, removeTable = action === 'paid-revoke' && table.size === '1'
      const nextTable = { id: table.id, size: String(BigInt(table.size) + (action === 'paid-revoke' ? -1n : f.entry ? 0n : 1n)) }
      field('buyer', paid.entries.id, 'address', A, f.grantee, `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, f.table, removeTable ? null : nextTable)
      field('entry', table.id, 'u32', N, 3, `${pkg}::paid_access::KindPaidEntry`, D.PaidEntry, f.entry,
        action === 'paid-revoke' ? null : { version: '1', scope_mask: '8', ownership_epoch_snapshot: '2',
          expires_at_ms: soulAccessPurchaseExpiry(plan.quote.durationMs, f.entry?.ownership_epoch_snapshot === '2' ? f.entry.expires_at_ms : null, '1100') })
      nextPaid.entries.size = String(BigInt(paid.entries.size) + (removeTable ? -1n : f.table ? 0n : 1n))
      if (removeTable) {
        ids.nestedTable = table.id
        effects.V2!.changedObjects.push([table.id, { inputState: { $kind: 'NotExist', NotExist: true },
          outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Deleted', Deleted: true } }])
      }
    }
    add('paid', paid.id, `${pkg}::paid_access::SoulPaidAccessList`, D.Paid, paid, nextPaid, shared)
  }
  if (soulAccessIsGrant(action) || action === 'paid-purchase') add('clock', accessId(6), '0x2::clock::Clock', D.Clock,
    { id: accessId(6), timestamp_ms: '1100' }, null, shared, true)
  if (soulAccessUsesMarket(action)) add('market', f.market.id, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs, f.market, null, shared, true)
  if (action === 'paid-configure' || action === 'paid-update') add('registry', f.registry.id, `${pkg}::kind_registry::KindRegistry`, D.Registry, f.registry, null, shared, true)
  if (action === 'paid-purchase') {
    coinInputs.forEach((coin, i) => add(`coin${i}`, coin.objectId, `0x2::coin::Coin<${d.paymentCoinType}>`, SoulAccessCoinBcs,
      { id: coin.objectId, balance: coin.balance }, i ? null : { id: coin.objectId, balance: String(coinInputs.reduce((sum, c) => sum + BigInt(c.balance), 0n) - BigInt(plan.quote.totalAtomic)) }, { AddressOwner: author }))
    add('price', accessId(8100), `0x2::coin::Coin<${d.paymentCoinType}>`, SoulAccessCoinBcs, null,
      { id: accessId(8100), balance: plan.quote.priceAtomic }, { AddressOwner: plan.currentOwner })
    if (plan.quote.feeAtomic !== '0') add('fee', accessId(8101), `0x2::coin::Coin<${d.paymentCoinType}>`, SoulAccessCoinBcs, null,
      { id: accessId(8101), balance: plan.quote.feeAtomic }, { AddressOwner: plan.quote.feeRecipient! })
  }
  function rehash(label: string, version = '12') {
    const id = ids[label], k = key(id, version), object = objects.get(k)!, row = rows.get(k)!
    row.bcs.value = bcs.Object.serialize(object).toBytes(); row.contents.value = new Uint8Array(object.data.Move.contents)
    row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
    if (version === '12') change(label).outputState.ObjectWrite![0] = row.digest
    else { const c = effects.V2!.changedObjects.find(([oid]) => oid === id)?.[1]
      if (c) c.inputState.Exist![0][1] = row.digest
      else effects.V2!.unchangedConsensusObjects.find(([oid]) => oid === id)![1].ReadOnlyRoot![1] = row.digest }
  }
  function rewrite(label: string, mutate: (value: any) => void, version = '12') {
    const k = key(ids[label], version), object = objects.get(k), codec = codecs.get(k)!, value = codec.parse(object.data.Move.contents)
    mutate(value); object.data.Move.contents = codec.serialize(value).toBytes(); rehash(label, version)
  }
  let checkpoint: bigint | undefined = 42n, address: string | null = author
  client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: {
    digest: record.packet.digest, transaction: { digest: record.packet.digest, bcs: { value: fromBase64(record.packet.bytes) } },
    effects: { transactionDigest: record.packet.digest, status: { success: effects.V2!.status.$kind === 'Success' }, bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() } },
    ...(checkpoint === undefined ? {} : { checkpoint }) } } }))
  const read = vi.fn(async () => structuredClone(f.observed)), getAddress = vi.fn(() => address)
  const sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const adapter = createSoulAccessAdapter({ client: client as never, getAddress, sign, read })
  return { ...f, plan, record, client, rows, objects, ids, effects, resolve, adapter, read, sign, getAddress, packet, change,
    rewrite, rehash, add, full, setAddress: (value: string | null) => { address = value }, setCheckpoint: (value: bigint | undefined) => { checkpoint = value } }
}
