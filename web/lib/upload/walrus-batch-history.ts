import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG, TESTNET_WALRUS_PACKAGE_CONFIG, blobIdToInt } from '@mysten/walrus'
import { profileReadStep } from '@soulidity/sdk'
import { historicalObjectOutput, readHistoricalMoveObject } from '../sui/historical-object'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { inspectWalrusBatchCertificate } from './walrus-batch-certificate'
import { parseWalrusBatchPreparation, walrusBatchPreparationHash, walrusBatchAddress, walrusBatchCanonicalJson,
  type WalrusBatchPreparation } from './walrus-batch-preparation'
import { parseWalrusBatchParentPacket, parseWalrusBatchRegistration, validateWalrusBatchIndices,
  type WalrusBatchParentPacket, type WalrusBatchRegisteredBlob, type WalrusBatchRegistrationProof,
  type WalrusBatchConsumptionProof } from './walrus-batch-store'

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Data = ReturnType<Transaction['getData']>
type Arg = NonNullable<Data['commands'][number]['MoveCall']>['arguments'][number]
const A = bcs.Address
const System = bcs.struct('System', { id: A, version: bcs.u64(), package_id: A, new_package_id: bcs.option(A) })
const Element = bcs.struct('Element', { bytes: bcs.byteVector() })
const EventBlob = bcs.struct('EventBlob', { blob_id: bcs.u256(), ending_checkpoint_sequence_number: bcs.u64() })
// Complete installed SDK SystemStateInnerV1 wire layout; changed layouts fail closed.
const SystemField = bcs.struct('Field', { id: A, name: bcs.u64(), value: bcs.struct('SystemStateInnerV1', {
  committee: bcs.struct('BlsCommittee', { members: bcs.vector(bcs.struct('Member', {
    public_key: Element, weight: bcs.u16(), node_id: A })), n_shards: bcs.u16(), epoch: bcs.u32(), total_aggregated_key: Element }),
  total_capacity_size: bcs.u64(), used_capacity_size: bcs.u64(), storage_price_per_unit_size: bcs.u64(), write_price_per_unit_size: bcs.u64(),
  future_accounting: bcs.struct('FutureAccountingRingBuffer', { current_index: bcs.u32(), length: bcs.u32(),
    ring_buffer: bcs.vector(bcs.struct('FutureAccounting', { epoch: bcs.u32(), used_capacity: bcs.u64(),
      rewards_to_distribute: bcs.struct('Balance', { value: bcs.u64() }) })) }),
  event_blob_certification_state: bcs.struct('EventBlobCertificationState', { latest_certified_blob: bcs.option(EventBlob),
    aggregate_weight_per_blob: bcs.struct('VecMap', { contents: bcs.vector(bcs.struct('Entry', { key: EventBlob, value: bcs.u16() })) }) }),
  deny_list_sizes: bcs.struct('ExtendedField', { id: A }),
}) })
const Blob = bcs.struct('Blob', { id: A, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('Storage', {
    id: A, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool() })
// https://github.com/MystenLabs/walrus/blob/main/contracts/walrus/sources/system/events.move
const Registered = bcs.struct('BlobRegistered', { epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), end_epoch: bcs.u32(), deletable: bcs.bool(), object_id: A })
const Certified = bcs.struct('BlobCertified', { epoch: bcs.u32(), blob_id: bcs.u256(), end_epoch: bcs.u32(),
  deletable: bcs.bool(), object_id: A, is_extension: bcs.bool() })
const Events = bcs.vector(bcs.struct('Event', { package_id: A, transaction_module: bcs.string(), sender: A,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`WALRUS_BATCH_HISTORY_${code}`) }
const same = (a: unknown, b: unknown) => walrusBatchCanonicalJson(a) === walrusBatchCanonicalJson(b)
function typedHash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length); return toBase58(blake2b(input, { dkLen: 32 }))
}
function decode<O, I>(codec: { parse(bytes: Uint8Array): O; serialize(value: I): { toBytes(): Uint8Array } }, bytes: Uint8Array): O {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value as unknown as I).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}
// Pinned SDK RS2 encodedBlobLength formula (utils/index); this is also checked
// against the historical reserve argument and embedded Storage size.
function encodedSize(size: number, shards: number) {
  const faulty = Math.floor((shards - 1) / 3), primary = shards - 2 * faulty, secondary = shards - faulty
  let symbol = Math.ceil(size / (primary * secondary)); symbol += symbol % 2
  return shards * (shards * 64 + 32) + (primary + secondary) * symbol * shards
}
export interface WalrusBatchParentHistoryContext {
  stage: 'register' | 'consume'; preparation: WalrusBatchPreparation; packet: WalrusBatchParentPacket
  effects: Effects; events: Uint8Array; checkpoint: string
  /** Exact commands owned by the checked uploader graph, including payment
   * split/destroy and transfers. Parent must authorize every other command and
   * the complete business effects/events using its frozen independent intent. */
  walrusCommandIndices: number[]; walrusEventIndices: number[]
  blobs: WalrusBatchRegisteredBlob[]; indices: number[]
}
export interface WalrusBatchHistoryOptions {
  client: SuiGrpcClient; chainIdentifier: string
  /** Mandatory full-PTB business verifier. Rebuilding an observed arbitrary
   * suffix is not verification. Check manifest commitment, mint/content/bind
   * identities, gas/payment limits, remaining inputs/commands/effects/events. */
  verifyParentTransaction(context: WalrusBatchParentHistoryContext & { signal: AbortSignal }): Promise<void>
}

/** Trusted-ledger history: canonical raw tx/effects/events and checkpoint
 * membership, not independent validator quorum verification. No current-owned
 * reads, signer, broadcaster, node writes or replacement registration exist. */
export function createWalrusBatchHistoryVerifier(options: WalrusBatchHistoryOptions) {
  const { client, chainIdentifier, verifyParentTransaction } = options
  check(typeof verifyParentTransaction === 'function', 'PARENT_VERIFIER_REQUIRED')
  check(/^[0-9a-f]{8}$/.test(chainIdentifier), 'CHAIN_IDENTIFIER_REQUIRED')
  async function finalized(preparation: WalrusBatchPreparation, packet: WalrusBatchParentPacket, signal: AbortSignal) {
    check(chainIdentifier === (preparation.manifest.scope.network === 'mainnet' ? '35834a8a' : '4c78adac'), 'NETWORK_MISMATCH')
    const { response } = await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: packet.digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest',
        'effects.status', 'events.bcs', 'checkpoint'] } }, { abort: signal }))
    const row = structuredClone(response.transaction)
    check(row?.digest === packet.digest && row.transaction?.digest === packet.digest && row.transaction.bcs?.value instanceof Uint8Array
      && toBase64(row.transaction.bcs.value) === packet.bytes && row.effects?.bcs?.value instanceof Uint8Array
      && row.effects.bcs.value.length > 0 && row.effects.bcs.value.length <= 1024 * 1024, 'RAW_TRANSACTION_REQUIRED')
    const effects = decode(bcs.TransactionEffects, row.effects.bcs.value), e = effects.V2
    check(e?.transactionDigest === packet.digest && row.effects.transactionDigest === packet.digest
      && e.status.$kind === 'Success' && row.effects.status?.success === true, 'SUCCESS_REQUIRED')
    check(row.checkpoint !== undefined && row.checkpoint >= 0n, 'FINALIZED_CHECKPOINT_REQUIRED')
    check(e.changedObjects.length <= 16384 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
      && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
      && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([key]) => key === id)), 'EFFECTS_DUPLICATES')
    const checkpoint = String(row.checkpoint), evidence = await readActivityCheckpointEvidence({ client, chainIdentifier, checkpoint, signal })
    const member = evidence.transactions.filter(value => value.transactionDigest === packet.digest)
    check(member.length === 1 && member[0].effectsDigest === typedHash('TransactionEffects', row.effects.bcs.value)
      && evidence.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
    const bytes = row.events?.bcs?.value
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 1024 * 1024
      && e.eventsDigest === typedHash('TransactionEvents', bytes), 'EVENTS_DIGEST')
    const events = decode(Events, bytes)
    check(events.length <= 16384, 'EVENTS_BUDGET')
    return { effects, events, eventBytes: bytes, checkpoint, data: Transaction.from(fromBase64(packet.bytes)).getData() }
  }
  type Final = Awaited<ReturnType<typeof finalized>>
  async function system(preparation: WalrusBatchPreparation, packet: WalrusBatchParentPacket, f: Final, signal: AbortSignal, mutable: boolean) {
    const systemId = (preparation.manifest.scope.network === 'mainnet' ? MAINNET_WALRUS_PACKAGE_CONFIG : TESTNET_WALRUS_PACKAGE_CONFIG).systemObjectId
    const mode = mutable ? 'mutated' : 'readonly'
    const version = mutable ? historicalObjectOutput(f.effects, systemId, 'mutated').version
      : f.effects.V2!.unchangedConsensusObjects.find(([id]) => id === systemId)?.[1].ReadOnlyRoot?.[0]
    check(version !== undefined, 'SYSTEM_REFERENCE_REQUIRED')
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: systemId, version: BigInt(version),
      readMask: { paths: ['object_type'] } }, { abort: signal }))
    const type = response.object?.objectType
    check(typeof type === 'string' && /^0x[0-9a-f]{64}::system::System$/.test(type), 'SYSTEM_TYPE')
    const root = await readHistoricalMoveObject({ client, signal, effects: f.effects, transactionDigest: packet.digest, objectId: systemId, type, mode })
    const value = decode(System, root.bytes), origin = type.split('::')[0]
    check(value.id === systemId && root.reference.owner.Shared && walrusBatchAddress(value.package_id), 'SYSTEM_OBJECT')
    const ref = f.data.inputs.filter(input => input.Object?.SharedObject?.objectId === systemId)
    check(ref.length === 1 && ref[0].Object!.SharedObject!.mutable === mutable
      && ref[0].Object!.SharedObject!.initialSharedVersion === root.reference.owner.Shared.initialSharedVersion, 'SYSTEM_INPUT')
    return { systemId, origin, value, root, argument: { $kind: 'Input', Input: f.data.inputs.indexOf(ref[0]) } as Arg }
  }
  type SystemProof = Awaited<ReturnType<typeof system>>
  function input(data: Data, argument: Arg) { check(argument.$kind === 'Input' && data.inputs[argument.Input], 'INPUT_REQUIRED'); return data.inputs[argument.Input] }
  function pure(data: Data, argument: Arg, expected: string) { check(input(data, argument).Pure?.bytes === expected, 'PURE_ARGUMENT') }
  function result(argument: Arg) {
    check(argument.$kind === 'Result' || argument.$kind === 'NestedResult' && argument.NestedResult[1] === 0, 'RESULT_REQUIRED')
    return argument.$kind === 'Result' ? argument.Result : argument.NestedResult![0]
  }
  function uses(data: Data, argument: Arg) {
    const found: number[] = []
    const key = (arg: Arg) => arg.$kind === 'Result' || arg.$kind === 'NestedResult'
      ? `result:${arg.$kind === 'Result' ? arg.Result : arg.NestedResult[0]}:${arg.$kind === 'Result' ? 0 : arg.NestedResult[1]}`
      : arg.$kind === 'Input' ? `input:${arg.Input}` : 'gas'
    const expected = key(argument)
    function visit(value: unknown, command: number) {
      if (!value || typeof value !== 'object') return
      if ('$kind' in value && ['Input', 'Result', 'NestedResult', 'GasCoin'].includes(String(value.$kind))) {
        if (key(value as Arg) === expected) found.push(command)
      } else for (const child of Object.values(value)) visit(child, command)
    }
    data.commands.forEach((command, index) => visit(command, index)); return found
  }
  function call(data: Data, index: number, pkg: string, name: string, argc: number) {
    const c = data.commands[index]?.MoveCall
    check(c && c.package === pkg && c.module === 'system' && c.function === name && c.typeArguments.length === 0
      && c.arguments.length === argc, 'WALRUS_CALL'); return c
  }
  function selectedEvents(f: Final, s: SystemProof, owner: string, name: string) {
    return f.events.flatMap((event, index) => {
      const tag = normalizeStructTag(TypeTagSerializer.tagToString({ struct: event.type_ }))
      if (!tag.startsWith(`${s.origin}::`)) return []
      check(tag === `${s.origin}::events::${name}` && event.package_id === s.value.package_id
        && event.transaction_module === 'system' && event.sender === owner, 'WALRUS_EVENT_AUTHORITY')
      return [{ index, bytes: event.contents }]
    })
  }
  async function parent(stage: 'register' | 'consume', preparation: WalrusBatchPreparation, packet: WalrusBatchParentPacket,
    f: Final, commands: Set<number>, events: number[], blobs: WalrusBatchRegisteredBlob[], indices: number[], signal: AbortSignal) {
    const context = structuredClone({ stage, preparation, packet, effects: f.effects, events: f.eventBytes,
      checkpoint: f.checkpoint, walrusCommandIndices: [...commands].sort((a, b) => a - b), walrusEventIndices: events, blobs, indices })
    await profileReadStep(signal, () => verifyParentTransaction({ ...context, signal })); signal.throwIfAborted()
  }
  async function registration(inputValue: { preparation: WalrusBatchPreparation; packet: WalrusBatchParentPacket; signal: AbortSignal }) {
    const p = parseWalrusBatchPreparation(inputValue.preparation), packet = parseWalrusBatchParentPacket(inputValue.packet, p.manifest.scope.owner), signal = inputValue.signal
    const f = await finalized(p, packet, signal)
    if (p.manifest.files.length === 0) {
      await parent('register', p, packet, f, new Set(), [], [], [], signal)
      return parseWalrusBatchRegistration({ preparationHash: walrusBatchPreparationHash(p), packet, blobs: [] }, p)
    }
    const s = await system(p, packet, f, signal, true), data = f.data
    const fieldId = deriveDynamicFieldID(s.systemId, 'u64', bcs.u64().serialize(s.value.version).toBytes())
    const field = await readHistoricalMoveObject({ client, signal, effects: f.effects, transactionDigest: packet.digest, objectId: fieldId,
      type: `0x2::dynamic_field::Field<u64,${s.origin}::system_state_inner::SystemStateInnerV1>`, mode: 'mutated' })
    const state = decode(SystemField, field.bytes), committee = state.value.committee
    check(state.id === fieldId && state.name === s.value.version && field.reference.owner.ObjectOwner === s.systemId
      && committee.n_shards > 0 && committee.members.length > 0 && committee.members.every(m => m.weight > 0)
      && committee.members.reduce((sum, m) => sum + m.weight, 0) === committee.n_shards, 'SYSTEM_STATE')
    const calls = data.commands.flatMap((command, index) => command.MoveCall?.package === s.value.package_id
      && command.MoveCall.module === 'system' && command.MoveCall.function === 'register_blob' ? [index] : [])
    const events = selectedEvents(f, s, p.manifest.scope.owner, 'BlobRegistered')
    check(calls.length === p.manifest.files.length && events.length === calls.length, 'REGISTER_COUNT')
    const commands = new Set<number>(), reserves = new Set<number>(), storageIds = new Set<string>(), objectIds = new Set<string>(), blobs: WalrusBatchRegisteredBlob[] = []
    const payments = new Set<string>(), splitPayments = new Map<number, Set<number>>(), paymentTypes = new Set<string>()
    const metadata = new WalrusClient({ network: p.manifest.scope.network, suiClient: client })
    function payment(argument: Arg, amount: bigint, before: number) {
      check(argument.$kind === 'NestedResult', 'PAYMENT_SPLIT')
      const index = argument.NestedResult[0], split = data.commands[index]?.SplitCoins
      check(index < before && split && argument.NestedResult[1] < split.amounts.length, 'PAYMENT_SPLIT')
      const paymentKey = `${index}:${argument.NestedResult[1]}`
      check(!payments.has(paymentKey), 'PAYMENT_ALIAS'); payments.add(paymentKey)
      const selected = splitPayments.get(index) ?? new Set<number>(); selected.add(argument.NestedResult[1]); splitPayments.set(index, selected)
      pure(data, split.amounts[argument.NestedResult[1]], bcs.u64().serialize(amount).toBase64())
      const destroy = data.commands.flatMap((c, i) => c.MoveCall?.package === '0x' + '2'.padStart(64, '0')
        && c.MoveCall.module === 'coin' && c.MoveCall.function === 'destroy_zero' && c.MoveCall.arguments.length === 1
        && same(c.MoveCall.arguments[0], argument) ? [i] : [])
      check(destroy.length === 1 && destroy[0] > before && data.commands[destroy[0]].MoveCall!.typeArguments.length === 1
        && /^0x[0-9a-f]{64}::wal::WAL$/.test(data.commands[destroy[0]].MoveCall!.typeArguments[0]), 'PAYMENT_DESTROY')
      check(same(uses(data, argument), [before, destroy[0]]), 'PAYMENT_GRAPH')
      paymentTypes.add(data.commands[destroy[0]].MoveCall!.typeArguments[0])
      commands.add(index); commands.add(destroy[0])
    }
    for (const file of p.manifest.files) {
      const index = calls[file.index], c = call(data, index, s.value.package_id, 'register_blob', 8), event = decode(Registered, events[file.index].bytes)
      check(same(c.arguments[0], s.argument) && file.encoding.nShards === committee.n_shards, 'REGISTER_SYSTEM')
      const encoded = await profileReadStep(signal, () => metadata.computeBlobMetadata({ bytes: p.payloads[file.index], numShards: committee.n_shards, nonce: new Uint8Array(32) }))
      check(encoded.blobId === file.encoding.blobId && toBase64(encoded.rootHash) === file.encoding.rootHash
        && Number(encoded.metadata.unencodedLength) === file.payloadByteLength && encoded.metadata.encodingType === 'RS2', 'PAYLOAD_ENCODING')
      pure(data, c.arguments[2], bcs.u256().serialize(blobIdToInt(file.encoding.blobId)).toBase64())
      pure(data, c.arguments[3], file.encoding.rootHash); pure(data, c.arguments[4], bcs.u64().serialize(file.payloadByteLength).toBase64())
      pure(data, c.arguments[5], bcs.u8().serialize(1).toBase64()); pure(data, c.arguments[6], bcs.bool().serialize(true).toBase64())
      const reserveIndex = result(c.arguments[1]), reserve = call(data, reserveIndex, s.value.package_id, 'reserve_space', 4)
      check(reserveIndex < index && !reserves.has(reserveIndex) && same(reserve.arguments[0], s.argument), 'RESERVE_GRAPH')
      check(same(uses(data, c.arguments[1]), [index]), 'RESERVE_RESULT_USAGE')
      reserves.add(reserveIndex); commands.add(reserveIndex); commands.add(index)
      const size = encodedSize(file.payloadByteLength, committee.n_shards), units = BigInt(Math.ceil(size / (1024 * 1024)))
      pure(data, reserve.arguments[1], bcs.u64().serialize(size).toBase64()); pure(data, reserve.arguments[2], bcs.u32().serialize(p.manifest.storageEpochs).toBase64())
      payment(reserve.arguments[3], units * BigInt(state.value.storage_price_per_unit_size) * BigInt(p.manifest.storageEpochs), reserveIndex)
      payment(c.arguments[7], units * BigInt(state.value.write_price_per_unit_size), index)
      const transfers = data.commands.flatMap((cmd, i) => cmd.TransferObjects?.objects.some(arg =>
        (arg.$kind === 'Result' && arg.Result === index) || (arg.$kind === 'NestedResult' && arg.NestedResult[0] === index && arg.NestedResult[1] === 0)) ? [i] : [])
      check(transfers.length === 1 && transfers[0] > index && data.commands[transfers[0]].TransferObjects!.objects.length === 1, 'REGISTER_TRANSFER')
      check(same(uses(data, { $kind: 'Result', Result: index } as Arg), transfers), 'REGISTER_RESULT_USAGE')
      pure(data, data.commands[transfers[0]].TransferObjects!.address, bcs.Address.serialize(file.recipient).toBase64()); commands.add(transfers[0])
      check(walrusBatchAddress(event.object_id) && !objectIds.has(event.object_id), 'REGISTER_OBJECT_ALIAS'); objectIds.add(event.object_id)
      const source = await readHistoricalMoveObject({ client, signal, effects: f.effects, transactionDigest: packet.digest,
        objectId: event.object_id, type: `${s.origin}::blob::Blob`, mode: 'created' })
      const blob = decode(Blob, source.bytes)
      check(blob.id === event.object_id && source.reference.owner.AddressOwner === file.recipient && blob.certified_epoch === null
        && blob.blob_id === String(blobIdToInt(file.encoding.blobId)) && blob.size === String(file.payloadByteLength)
        && blob.encoding_type === 1 && blob.deletable && blob.registered_epoch === committee.epoch
        && blob.storage.start_epoch === committee.epoch && blob.storage.end_epoch === committee.epoch + p.manifest.storageEpochs
        && blob.storage.storage_size === String(size) && walrusBatchAddress(blob.storage.id) && !storageIds.has(blob.storage.id), 'REGISTER_BLOB')
      storageIds.add(blob.storage.id)
      check(same(event, { epoch: committee.epoch, blob_id: blob.blob_id, size: blob.size, encoding_type: 1,
        end_epoch: blob.storage.end_epoch, deletable: true, object_id: blob.id }), 'REGISTER_EVENT')
      blobs.push({ index: file.index, objectId: blob.id, version: String(source.reference.version), digest: source.reference.digest,
        blobId: file.encoding.blobId, rootHash: file.encoding.rootHash, size: blob.size, recipient: file.recipient,
        encodingType: 1, registeredEpoch: blob.registered_epoch, storageStartEpoch: blob.storage.start_epoch, storageEndEpoch: blob.storage.end_epoch })
    }
    for (const id of storageIds) {
      check(!objectIds.has(id), 'STORAGE_UID_ALIAS')
      const changes = f.effects.V2!.changedObjects.filter(([key]) => key === id), change = changes[0]?.[1]
      check(changes.length === 1 && change.inputState.$kind === 'NotExist' && change.outputState.$kind === 'NotExist'
        && change.idOperation.$kind === 'Created', 'STORAGE_CREATED_WRAPPED')
    }
    check(paymentTypes.size === 1 && [...splitPayments].every(([index, selected]) => selected.size === data.commands[index].SplitCoins!.amounts.length),
      'PAYMENT_SPLIT_COVERAGE')
    // CoinWithBalance can group all charges into one split, merge owned coins,
    // or redeem the sender's address balance. Validate the installed SDK funding
    // shapes too, so caller code never has to accept an arbitrary funding tail.
    const walType = [...paymentTypes][0], totalPayment = [...splitPayments.keys()].reduce((total, index) => total
      + data.commands[index].SplitCoins!.amounts.reduce((sum, argument) => sum + BigInt(decode(bcs.u64(), fromBase64(input(data, argument).Pure!.bytes))), 0n), 0n)
    const redeemed = new Set<number>(), fundingBases = new Map<string, Arg>()
    function fundingCoin(argument: Arg, before: number) {
      if (argument.$kind === 'Input') { check(input(data, argument).Object?.ImmOrOwnedObject, 'PAYMENT_COIN'); return }
      const index = result(argument), redeem = data.commands[index]?.MoveCall
      check(index < before && redeem?.package === '0x' + '2'.padStart(64, '0') && redeem.module === 'coin'
        && redeem.function === 'redeem_funds' && same(redeem.typeArguments, [walType]) && redeem.arguments.length === 1, 'PAYMENT_REDEEM')
      const withdrawal = input(data, redeem.arguments[0]).FundsWithdrawal
      check(withdrawal?.reservation.$kind === 'MaxAmountU64' && BigInt(withdrawal.reservation.MaxAmountU64) > 0n
        && BigInt(withdrawal.reservation.MaxAmountU64) <= totalPayment && withdrawal.typeArg.Balance === walType
        && withdrawal.withdrawFrom.$kind === 'Sender' && same(uses(data, redeem.arguments[0]), [index]), 'PAYMENT_WITHDRAWAL')
      redeemed.add(index); commands.add(index)
    }
    for (const index of splitPayments.keys()) {
      const base = data.commands[index].SplitCoins!.coin; fundingCoin(base, index)
      fundingBases.set(walrusBatchCanonicalJson(base), base)
    }
    for (const base of fundingBases.values()) {
      const sourceIds = new Set<string>(), fundingUses = uses(data, base)
      let disposal = false
      for (const index of fundingUses) {
        if (splitPayments.has(index)) { check(!disposal, 'PAYMENT_AFTER_DISPOSAL'); continue }
        const merge = data.commands[index].MergeCoins
        if (merge && same(merge.destination, base)) {
          check(!disposal && merge.sources.length > 0, 'PAYMENT_MERGE')
          for (const source of merge.sources) {
            const key = walrusBatchCanonicalJson(source)
            check(!same(source, base) && !sourceIds.has(key) && same(uses(data, source), [index]), 'PAYMENT_MERGE_ALIAS')
            sourceIds.add(key); fundingCoin(source, index)
          }
          commands.add(index); continue
        }
        const c = data.commands[index].MoveCall
        check(!disposal && c?.package === '0x' + '2'.padStart(64, '0') && c.module === 'coin' && same(c.typeArguments, [walType])
          && same(c.arguments[0], base) && (c.function === 'destroy_zero' && c.arguments.length === 1
            || c.function === 'send_funds' && c.arguments.length === 2), 'PAYMENT_FUNDING_GRAPH')
        if (c.function === 'send_funds') pure(data, c.arguments[1], bcs.Address.serialize(p.manifest.scope.owner).toBase64())
        disposal = true; commands.add(index)
      }
      if (base.$kind !== 'Input') check(disposal, 'REDEEMED_COIN_DISPOSAL')
    }
    check([...redeemed].reduce((sum, index) => sum + BigInt(input(data, data.commands[index].MoveCall!.arguments[0]).FundsWithdrawal!.reservation.MaxAmountU64!), 0n)
      <= totalPayment, 'PAYMENT_WITHDRAWAL_TOTAL')
    check(data.commands.every((c, i) => c.MoveCall?.package !== s.value.package_id || commands.has(i)), 'EXTRA_WALRUS_CALL')
    await parent('register', p, packet, f, commands, events.map(e => e.index), blobs, blobs.map(b => b.index), signal)
    return parseWalrusBatchRegistration({ preparationHash: walrusBatchPreparationHash(p), packet, blobs }, p)
  }
  async function consumption(inputValue: { preparation: WalrusBatchPreparation; registration: WalrusBatchRegistrationProof;
    packet: WalrusBatchParentPacket; indices: number[]; certificates: Array<{ index: number; certificate: string }>; signal: AbortSignal }): Promise<WalrusBatchConsumptionProof> {
    const p = parseWalrusBatchPreparation(inputValue.preparation), claimed = parseWalrusBatchRegistration(inputValue.registration, p)
    const packet = parseWalrusBatchParentPacket(inputValue.packet, p.manifest.scope.owner), signal = inputValue.signal
    const indices = validateWalrusBatchIndices(inputValue.indices, p.manifest.files.length), certificates = structuredClone(inputValue.certificates)
    check(packet.digest !== claimed.packet.digest && certificates.length === indices.length && new Set(certificates.map(c => c.index)).size === indices.length
      && certificates.every(c => indices.includes(c.index)), 'CONSUME_SCOPE')
    const proven = await registration({ preparation: p, packet: claimed.packet, signal })
    check(same(proven, claimed), 'REGISTRATION_PROOF_MISMATCH')
    const originalFinal = await finalized(p, proven.packet, signal)
    const f = await finalized(p, packet, signal), s = await system(p, packet, f, signal, false), data = f.data
    const events = selectedEvents(f, s, p.manifest.scope.owner, 'BlobCertified'), commands = new Set<number>()
    const calls = data.commands.flatMap((c, i) => c.MoveCall?.package === s.value.package_id && c.MoveCall.module === 'system'
      && c.MoveCall.function === 'certify_blob' ? [i] : [])
    check(calls.length === indices.length && events.length === indices.length, 'CERTIFY_COUNT')
    for (const [position, index] of indices.entries()) {
      const expected = proven.blobs[index], callIndex = calls[position], c = call(data, callIndex, s.value.package_id, 'certify_blob', 5)
      check(same(c.arguments[0], s.argument), 'CERTIFY_SYSTEM')
      const owned = input(data, c.arguments[1]).Object?.ImmOrOwnedObject
      check(owned?.objectId === expected.objectId, 'CERTIFY_BLOB_INPUT')
      const output = await readHistoricalMoveObject({ client, signal, effects: f.effects, transactionDigest: packet.digest,
        objectId: expected.objectId, type: `${s.origin}::blob::Blob`, mode: 'mutated' })
      const ref = output.reference
      check(ref.inputOwner?.AddressOwner === expected.recipient && ref.inputVersion === BigInt(owned.version) && ref.inputDigest === owned.digest
        && ref.inputVersion >= BigInt(expected.version) && (ref.inputVersion !== BigInt(expected.version) || ref.inputDigest === expected.digest), 'CERTIFY_LINEAGE')
      // Fetch the authenticated actual input even when transferred away and
      // returned between stages. A later version alone is never lineage proof.
      const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: expected.objectId, version: ref.inputVersion!,
        readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
      const row = structuredClone(response.object), bytes = row?.bcs?.value
      check(row?.objectId === expected.objectId && row.version === ref.inputVersion && row.digest === ref.inputDigest
        && bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 65536 && typedHash('Object', bytes) === ref.inputDigest, 'CERTIFY_INPUT_BCS')
      const object = decode(bcs.Object, bytes), move = object.data.Move
      check(move?.type.Other && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other })) === `${s.origin}::blob::Blob`
        && move.version === String(ref.inputVersion) && same(object.owner, ref.inputOwner), 'CERTIFY_INPUT_OBJECT')
      const before = decode(Blob, move.contents), after = decode(Blob, output.bytes)
      // Original registration object also binds the nested Storage UID.
      const first = await readHistoricalMoveObject({ client, signal, effects: originalFinal.effects,
        transactionDigest: proven.packet.digest, objectId: expected.objectId, type: `${s.origin}::blob::Blob`, mode: 'created' })
      const original = decode(Blob, first.bytes)
      check(same(before, original) && before.certified_epoch === null && after.certified_epoch !== null
        && after.certified_epoch >= before.registered_epoch && after.certified_epoch < before.storage.end_epoch
        && same({ ...after, certified_epoch: null }, before), 'CERTIFY_STORAGE_LINEAGE')
      check(!f.effects.V2!.changedObjects.some(([id]) => id === original.storage.id)
        && !f.effects.V2!.unchangedConsensusObjects.some(([id]) => id === original.storage.id), 'CERTIFY_STORAGE_UID_RETAINED')
      const inspected = inspectWalrusBatchCertificate(certificates.find(c => c.index === index)!.certificate,
        { blobId: expected.blobId, blobObjectId: expected.objectId, epoch: after.certified_epoch })
      pure(data, c.arguments[2], bcs.byteVector().serialize(inspected.certificate.signature).toBase64())
      pure(data, c.arguments[4], bcs.byteVector().serialize(inspected.certificate.serializedMessage).toBase64())
      const bitmapInput = input(data, c.arguments[3]).Pure
      check(bitmapInput, 'CERTIFY_BITMAP_REQUIRED'); const bitmap = decode(bcs.byteVector(), fromBase64(bitmapInput.bytes)), bitmapExpected = new Uint8Array(bitmap.length)
      check(bitmap.length > 0 && bitmap.length <= 8192 && inspected.certificate.signers.every(n => n < bitmap.length * 8), 'CERTIFY_BITMAP_SIZE')
      for (const signer of inspected.certificate.signers) bitmapExpected[Math.floor(signer / 8)] |= 1 << (signer % 8)
      check(toBase64(bitmap) === toBase64(bitmapExpected), 'CERTIFY_BITMAP')
      check(same(decode(Certified, events[position].bytes), { epoch: after.certified_epoch, blob_id: after.blob_id,
        end_epoch: after.storage.end_epoch, deletable: true, object_id: after.id, is_extension: false }), 'CERTIFY_EVENT')
      commands.add(callIndex)
    }
    check(data.commands.every((c, i) => c.MoveCall?.package !== s.value.package_id || commands.has(i)), 'EXTRA_WALRUS_CALL')
    await parent('consume', p, packet, f, commands, events.map(e => e.index), proven.blobs, indices, signal)
    return { preparationHash: walrusBatchPreparationHash(p), registerDigest: proven.packet.digest, packet, indices,
      blobObjectIds: indices.map(index => proven.blobs[index].objectId) }
  }
  return { verifyRegistration: registration, verifyConsumption: consumption }
}
