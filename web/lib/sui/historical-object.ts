import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Owner = ReturnType<typeof bcs.Owner.parse>
/** Sui uses compact enum variants for standard objects rather than Other.
 * These are the same Move struct identities, not alternate application ABIs.
 * Accumulator fields lack store and cannot be generic joined assets. */
export function historicalMoveObjectType(type: ReturnType<typeof bcs.MoveObjectType.parse>): string {
  if (type.Other) return normalizeStructTag(TypeTagSerializer.tagToString({ struct: type.Other }))
  if (type.$kind === 'GasCoin') return normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
  if (type.$kind === 'StakedSui') return normalizeStructTag('0x3::staking_pool::StakedSui')
  if (type.Coin) return normalizeStructTag(`0x2::coin::Coin<${type.Coin}>`)
  throw new Error('HISTORICAL_OBJECT_UNSUPPORTED_MOVE_TYPE')
}
export interface HistoricalObjectReference {
  version: bigint; digest: string; owner: Owner; created: boolean
  inputVersion: bigint | null; inputDigest: string | null; inputOwner: Owner | null
}
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`HISTORICAL_OBJECT_${code}`) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const uint = (n: bigint) => n > 0n && n <= 18446744073709551615n
function digest(v: string) { check(fromBase58(v).length === 32 && toBase58(fromBase58(v)) === v, 'INVALID_DIGEST') }

/** Current deployment uses effects V2. A historical output is selected solely
 * by its final effects, never by a newly observed object version. */
export function historicalObjectOutput(effects: Effects, objectId: string,
  mode: 'created' | 'mutated' | 'written' = 'written'): HistoricalObjectReference {
  return historicalObjectOutputForStatus(effects, objectId, mode, 'Success')
}
function historicalObjectOutputForStatus(effects: Effects, objectId: string,
  mode: 'created' | 'mutated' | 'written', status: 'Success' | 'Failure'): HistoricalObjectReference {
  const e = effects.V2
  check(e && e.status.$kind === status, status === 'Success' ? 'SUCCESSFUL_V2_EFFECTS_REQUIRED' : 'FAILED_V2_EFFECTS_REQUIRED')
  const matches = e.changedObjects.filter(([id]) => id === objectId)
  check(matches.length === 1 && !e.unchangedConsensusObjects.some(([id]) => id === objectId), 'OUTPUT_NOT_UNIQUE')
  const change = matches[0][1], write = change.outputState.ObjectWrite, version = BigInt(e.lamportVersion)
  check(write && uint(version) && ['Created', 'None'].includes(change.idOperation.$kind), 'INVALID_OUTPUT')
  const created = change.idOperation.$kind === 'Created', input = change.inputState.Exist
  check(created ? change.inputState.$kind === 'NotExist' : input && uint(BigInt(input[0][0])) && BigInt(input[0][0]) < version,
    'INVALID_LINEAGE')
  check(mode === 'written' || (mode === 'created') === created, 'LIFETIME_MISMATCH')
  digest(write[0]); if (input) digest(input[0][1])
  return { version, digest: write[0], owner: structuredClone(write[1]), created,
    inputVersion: input ? BigInt(input[0][0]) : null, inputDigest: input?.[0][1] ?? null,
    inputOwner: input ? structuredClone(input[1]) : null }
}

/** Exact original input, including a coin consumed/deleted by gas smashing or
 * merging. No current version or replacement object can establish this input. */
export function historicalObjectInput(effects: Effects, objectId: string): HistoricalObjectReference {
  return historicalObjectInputForStatus(effects, objectId, 'Success')
}
function historicalObjectInputForStatus(effects: Effects, objectId: string, status: 'Success' | 'Failure'): HistoricalObjectReference {
  const e = effects.V2
  check(e?.status.$kind === status, status === 'Success' ? 'SUCCESSFUL_V2_EFFECTS_REQUIRED' : 'FAILED_V2_EFFECTS_REQUIRED')
  const matches = e.changedObjects.filter(([id]) => id === objectId), change = matches[0]?.[1], input = change?.inputState.Exist
  check(matches.length === 1 && !e.unchangedConsensusObjects.some(([id]) => id === objectId) && input
    && ['None', 'Deleted'].includes(change.idOperation.$kind), 'INPUT_NOT_UNIQUE')
  const version = BigInt(input[0][0])
  check(uint(version) && uint(BigInt(e.lamportVersion)) && version < BigInt(e.lamportVersion), 'INVALID_INPUT_VERSION')
  digest(input[0][1])
  return { version, digest: input[0][1], owner: structuredClone(input[1]), created: false,
    inputVersion: version, inputDigest: input[0][1], inputOwner: structuredClone(input[1]) }
}

/** Require the full canonical Object BCS and recompute its typed Sui digest.
 * Merely labelling arbitrary contents with an effects digest is not proof. */
type HistoricalMoveObjectInput = {
  client: SuiGrpcClient; effects: Effects; transactionDigest: string; objectId: string; type: string
  signal: AbortSignal; mode?: 'created' | 'mutated' | 'written' | 'readonly' | 'input'; maxBytes?: number
}
export async function readHistoricalMoveObject(params: HistoricalMoveObjectInput) {
  return readHistoricalMoveObjectWithStatus(params, 'Success')
}
/** Authenticate a created output before classifying its Move type. */
export async function readHistoricalCreatedMoveObject(params: Omit<HistoricalMoveObjectInput, 'type' | 'mode'>) {
  return readHistoricalMoveObjectWithStatus({ ...params, mode: 'created' }, 'Success')
}
/** Authenticate a consumed SUI Coin input even when the finalized transaction
 * failed. This verifies the input only and makes no claim about business success. */
export async function readHistoricalSpentSuiCoin(params: Omit<HistoricalMoveObjectInput, 'type' | 'mode' | 'maxBytes'>) {
  const effects = structuredClone(params.effects), status = effects.V2?.status.$kind
  check(status === 'Success' || status === 'Failure', 'SPENT_COIN_EFFECTS_STATUS')
  const type = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
  const coin = await readHistoricalMoveObjectWithStatus({ ...params, effects, type, mode: 'input', maxBytes: 128 }, status)
  check(coin.object.owner.AddressOwner, 'SPENT_COIN_ADDRESS_OWNER')
  return coin
}

/** Narrow failed-transaction object evidence for an unchanged Shared root.
 * Preserves real Failure effects; cannot read coins, created/deleted objects,
 * readonly roots, or a business result as successful. Parent proves finality
 * and compares before/after payloads before continuing any child history. */
export async function readHistoricalFailedSharedRoot(params: Omit<HistoricalMoveObjectInput, 'mode'> & { mode: 'input' | 'mutated' }) {
  const effects = structuredClone(params.effects), e = effects.V2
  check(e?.status.$kind === 'Failure' && ['input', 'mutated'].includes(params.mode), 'FAILED_SHARED_ROOT_SCOPE')
  const matches = e.changedObjects.filter(([id]) => id === params.objectId), change = matches[0]?.[1]
  check(matches.length === 1 && change.idOperation.$kind === 'None' && change.inputState.Exist?.[1].Shared
    && change.outputState.ObjectWrite?.[1].Shared
    && change.inputState.Exist[1].Shared.initialSharedVersion === change.outputState.ObjectWrite[1].Shared.initialSharedVersion, 'FAILED_SHARED_ROOT_LINEAGE')
  const value = await readHistoricalMoveObjectWithStatus({ ...params, effects }, 'Failure')
  check(value.object.owner.Shared, 'FAILED_SHARED_ROOT_OWNER')
  return value
}
async function readHistoricalMoveObjectWithStatus(params: Omit<HistoricalMoveObjectInput, 'type'> & { type?: string }, status: 'Success' | 'Failure') {
  const { client, signal } = params
  const { effects, transactionDigest, objectId, type, mode, maxBytes } = structuredClone({ effects: params.effects,
    transactionDigest: params.transactionDigest, objectId: params.objectId, type: params.type,
    mode: params.mode ?? 'written', maxBytes: params.maxBytes ?? 1024 * 1024 })
  check(/^0x[0-9a-f]{64}$/.test(objectId) && !/^0x0+$/.test(objectId), 'INVALID_ID')
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 4 * 1024 * 1024, 'INVALID_BUDGET')
  check(['created', 'mutated', 'written', 'readonly', 'input'].includes(mode), 'INVALID_MODE')
  check(effects.V2?.transactionDigest === transactionDigest, 'TRANSACTION_MISMATCH'); digest(transactionDigest)
  let reference: Omit<HistoricalObjectReference, 'owner'> & { owner: Owner | null }
  if (mode === 'readonly') {
    const e = effects.V2
    check(e?.status.$kind === 'Success' && !e.changedObjects.some(([id]) => id === objectId), 'READONLY_EFFECTS_MISMATCH')
    const matches = e.unchangedConsensusObjects.filter(([id]) => id === objectId)
    const root = matches[0]?.[1].ReadOnlyRoot
    check(matches.length === 1 && root && uint(BigInt(root[0])) && uint(BigInt(e.lamportVersion))
      && BigInt(root[0]) < BigInt(e.lamportVersion), 'READONLY_ROOT_REQUIRED'); digest(root[1])
    // Owner is established only after verifying the full Object digest below.
    reference = { version: BigInt(root[0]), digest: root[1], owner: null,
      created: false, inputVersion: BigInt(root[0]), inputDigest: root[1], inputOwner: null }
  } else reference = mode === 'input' ? historicalObjectInputForStatus(effects, objectId, status) : historicalObjectOutputForStatus(effects, objectId, mode, status)
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: reference.version,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
  const row = structuredClone(response.object)
  check(row?.objectId === objectId && row.version === reference.version && row.digest === reference.digest
    && (mode === 'readonly' || mode === 'input' || row.previousTransaction === transactionDigest)
    && typeof row.objectType === 'string' && (type === undefined || row.objectType === normalizeStructTag(type)), 'REFERENCE_MISMATCH')
  check(row.bcs?.value instanceof Uint8Array && row.bcs.value.length > 0 && row.bcs.value.length <= maxBytes + 1024
    && row.contents?.value instanceof Uint8Array && row.contents.value.length > 0 && row.contents.value.length <= maxBytes, 'BCS_BUDGET')
  const bytes = row.bcs.value, object = bcs.Object.parse(bytes), move = object.data.Move
  const domain = new TextEncoder().encode('Object::'), preimage = new Uint8Array(domain.length + bytes.length)
  preimage.set(domain); preimage.set(bytes, domain.length)
  check(toBase64(bcs.Object.serialize(object).toBytes()) === toBase64(bytes)
    && toBase58(blake2b(preimage, { dkLen: 32 })) === reference.digest, 'BCS_DIGEST_MISMATCH')
  check(move && move.version === String(reference.version)
    && historicalMoveObjectType(move.type) === row.objectType
    && `0x${toHex(move.contents.subarray(0, 32))}` === objectId
    && toBase64(move.contents) === toBase64(row.contents.value)
    && object.previousTransaction === row.previousTransaction && (mode === 'readonly' || same(object.owner, reference.owner)), 'BCS_OBJECT_MISMATCH')
  if (mode === 'readonly') {
    check(object.owner.$kind === 'Shared', 'READONLY_OWNER_NOT_SHARED')
    reference = { ...reference, owner: structuredClone(object.owner), inputOwner: structuredClone(object.owner) }
  }
  const owner = object.owner, raw = row.owner
  check(owner.AddressOwner !== undefined ? raw?.kind === 1 && raw.address === owner.AddressOwner
    : owner.ObjectOwner !== undefined ? raw?.kind === 2 && raw.address === owner.ObjectOwner
      : owner.Shared !== undefined ? raw?.kind === 3 && raw.version === BigInt(owner.Shared.initialSharedVersion)
        : owner.$kind === 'Immutable' && raw?.kind === 4, 'OWNER_MISMATCH')
  if (owner.Shared) check(uint(BigInt(owner.Shared.initialSharedVersion)) && BigInt(owner.Shared.initialSharedVersion) <= reference.version, 'INVALID_SHARED_BIRTH')
  check(reference.owner, 'OWNER_REQUIRED')
  return { bytes: new Uint8Array(move.contents), object, type: row.objectType, reference: { ...reference, owner: reference.owner } }
}
