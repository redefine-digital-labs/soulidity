import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { proveExplicitInputConflict, readOriginalSuiGasReferences, validateExplicitGasConflict,
  type ExplicitGasConflict } from './explicit-gas-conflict'
import { readIndexedRetirementSnapshot } from './indexed-retirement-snapshot'
import { commerceCheck as check, decodeCommerce } from './economics-read'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const SUI_COIN = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')

export const canRetireNativeSaleOriginal = (packet: PublicMutationPacket) =>
  ['PREPARED', 'SIGNING', 'SIGNED'].includes(packet.phase)

export const retiredNativeSaleResult = (digest: string) => ({ status: 'RETIRED' as const, retiredOriginalDigest: digest })

export type NativeSaleRetirement = EpochCheckpoint & { conflict?: ExplicitGasConflict }

export function validateNativeSaleRetirement(packet: PublicMutationPacket, saved: NativeSaleRetirement | undefined) {
  check((packet.phase === 'RETIRED') === (saved !== undefined), 'NATIVE_SALE_RETIREMENT_PHASE')
  if (saved !== undefined) {
    check(saved && Object.keys(saved).sort().join(',') === (saved.conflict ? 'bytes,conflict,digest,epoch,sequenceNumber' : 'bytes,digest,epoch,sequenceNumber'),
      'NATIVE_SALE_RETIREMENT_FIELDS')
    validateEpochCheckpoint(saved, packet.expirationEpoch)
    if (saved.conflict) validateExplicitGasConflict(saved.conflict, packet, saved, 'NATIVE_SALE_RETIREMENT')
  }
}

export function assertNativeSaleRetirementUnchanged(before: { retirement?: NativeSaleRetirement }, after: { retirement?: NativeSaleRetirement }) {
  check(!before.retirement || canonical(before.retirement) === canonical(after.retirement), 'NATIVE_SALE_RETIREMENT_CHANGED')
}

/** After expiry, an unchanged primary Gas Coin or a finalized transaction
 * consuming an exact original gas reference rules out execution of the original.
 * Indexed observations share a checkpoint with canonical gRPC evidence.
 * Query the original digest again after verifying either witness. */
export async function verifyNativeSaleRetirement(input: {
  client: SuiGrpcClient; packet: PublicMutationPacket; author: string; signal: AbortSignal
  saved?: NativeSaleRetirement; conflictDigest?: string; queryOriginal: () => Promise<{ status: string }>
}) {
  const { client, author, signal, queryOriginal, conflictDigest } = input
  const { packet, saved } = structuredClone({ packet: input.packet, saved: input.saved })
  const gasRefs = readOriginalSuiGasReferences(packet, author, 'NATIVE_SALE_RETIREMENT'), gas = gasRefs[0]
  check(conflictDigest === undefined || !saved && marketListDigest(conflictDigest) && conflictDigest !== packet.digest, 'NATIVE_SALE_CONFLICT_DIGEST')
  const candidate = saved?.conflict?.digest ?? conflictDigest
  const proof = { client, signal, originalDigest: packet.digest, author, originalRefs: gasRefs }
  if (candidate) {
    const checkpoint = await readEpochExpiry(client, packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved, 'NATIVE_SALE_RETIREMENT')
    const conflict = await proveExplicitInputConflict({ ...proof, maxCheckpoint: checkpoint.sequenceNumber, candidate, saved: saved?.conflict })
    await assertOriginalMissing()
    return { ...checkpoint, conflict }
  }
  const selected = await readIndexedRetirementSnapshot({ packet, saved, objectId: gas.objectId, signal, prefix: 'NATIVE_SALE_RETIREMENT' })
  const object = selected.query.object
  check(object?.address === gas.objectId && Number.isSafeInteger(object.version) && BigInt(object.version!) >= BigInt(gas.version)
    && typeof object.digest === 'string' && typeof object.objectBcs === 'string' && object.objectBcs.length <= 8192,
  'NATIVE_SALE_RETIREMENT_GAS_CHANGED')
  const version = String(object.version), unchanged = version === String(gas.version)
  check(unchanged ? object.digest === gas.digest : saved === undefined && object.digest !== gas.digest, 'NATIVE_SALE_RETIREMENT_GAS_CHANGED')
  const raw = collectionCommandRaw({ objectId: gas.objectId, version, digest: object.digest, bcs: object.objectBcs })
  check(raw.owner.AddressOwner && (!unchanged || raw.owner.AddressOwner === author)
    && raw.data.Move && historicalMoveObjectType(raw.data.Move.type) === SUI_COIN
    && decodeCommerce(Coin, raw.data.Move.contents).id === gas.objectId, 'NATIVE_SALE_RETIREMENT_GAS_COIN')
  const checkpoint = await readEpochExpiry(client, packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST,
    saved, 'NATIVE_SALE_RETIREMENT', String(selected.sequenceNumber))
  check(checkpoint.digest === selected.digest && checkpoint.epoch === String(selected.epoch!.epochId), 'NATIVE_SALE_RETIREMENT_CHECKPOINT_MISMATCH')
  const conflict = unchanged ? undefined : await proveExplicitInputConflict({ ...proof, maxCheckpoint: checkpoint.sequenceNumber,
    candidate: { version, digest: object.digest, writer: raw.previousTransaction } })
  await assertOriginalMissing()
  return conflict ? { ...checkpoint, conflict } : checkpoint

  async function assertOriginalMissing() {
    const original = await queryOriginal()
    check(original.status === 'MISSING', 'NATIVE_SALE_RETIREMENT_ORIGINAL_FOUND')
    signal.throwIfAborted()
  }
}
