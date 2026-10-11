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
  const e = effects.V2
  check(e && e.status.$kind === 'Success', 'SUCCESSFUL_V2_EFFECTS_REQUIRED')
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

/** Require the full canonical Object BCS and recompute its typed Sui digest.
 * Merely labelling arbitrary contents with an effects digest is not proof. */
export async function readHistoricalMoveObject(params: {
  client: SuiGrpcClient; effects: Effects; transactionDigest: string; objectId: string; type: string
  signal: AbortSignal; mode?: 'created' | 'mutated' | 'written' | 'readonly'; maxBytes?: number
}) {
  const { client, signal } = params
  const { effects, transactionDigest, objectId, type, mode, maxBytes } = structuredClone({ effects: params.effects,
    transactionDigest: params.transactionDigest, objectId: params.objectId, type: params.type,
    mode: params.mode ?? 'written', maxBytes: params.maxBytes ?? 1024 * 1024 })
  check(/^0x[0-9a-f]{64}$/.test(objectId) && !/^0x0+$/.test(objectId), 'INVALID_ID')
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 4 * 1024 * 1024, 'INVALID_BUDGET')
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
  } else reference = historicalObjectOutput(effects, objectId, mode)
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: reference.version,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
  const row = structuredClone(response.object)
  check(row?.objectId === objectId && row.version === reference.version && row.digest === reference.digest
    && (mode === 'readonly' || row.previousTransaction === transactionDigest)
    && row.objectType === normalizeStructTag(type), 'REFERENCE_MISMATCH')
  check(row.bcs?.value instanceof Uint8Array && row.bcs.value.length > 0 && row.bcs.value.length <= maxBytes + 1024
    && row.contents?.value instanceof Uint8Array && row.contents.value.length > 0 && row.contents.value.length <= maxBytes, 'BCS_BUDGET')
  const bytes = row.bcs.value, object = bcs.Object.parse(bytes), move = object.data.Move
  const domain = new TextEncoder().encode('Object::'), preimage = new Uint8Array(domain.length + bytes.length)
  preimage.set(domain); preimage.set(bytes, domain.length)
  check(toBase64(bcs.Object.serialize(object).toBytes()) === toBase64(bytes)
    && toBase58(blake2b(preimage, { dkLen: 32 })) === reference.digest, 'BCS_DIGEST_MISMATCH')
  check(move && move.version === String(reference.version)
    && historicalMoveObjectType(move.type) === normalizeStructTag(type)
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
  return { bytes: new Uint8Array(move.contents), object, reference: { ...reference, owner: reference.owner } }
}
