import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { proveExplicitGasConflict, readOriginalSuiGasReferences, validateExplicitGasConflict,
  type ExplicitGasConflict } from './explicit-gas-conflict'
import { commerceCheck as check, decodeCommerce } from './economics-read'

const endpoint = 'https://graphql.mainnet.sui.io/graphql'
const query = `query NativeSaleRetirement($checkpoint: UInt53, $coin: SuiAddress!, $digest: String!) {
  chainIdentifier
  checkpoint(sequenceNumber: $checkpoint) {
    sequenceNumber digest epoch { epochId }
    query { object(address: $coin) { address version digest objectBcs } transaction(digest: $digest) { digest } }
  }
}`
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

interface Snapshot {
  errors?: unknown
  data?: { chainIdentifier?: string; checkpoint?: {
    sequenceNumber?: number; digest?: string; epoch?: { epochId?: number };
    query?: { object?: { address?: string; version?: number; digest?: string; objectBcs?: string } | null; transaction?: { digest: string } | null }
  } }
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
  const fetchSnapshot = globalThis.fetch
  const gasRefs = readOriginalSuiGasReferences(packet, author, 'NATIVE_SALE_RETIREMENT'), gas = gasRefs[0]
  check(conflictDigest === undefined || !saved && marketListDigest(conflictDigest) && conflictDigest !== packet.digest, 'NATIVE_SALE_CONFLICT_DIGEST')
  const candidate = saved?.conflict?.digest ?? conflictDigest
  const proof = { client, signal, originalDigest: packet.digest, author, gasRefs }
  if (candidate) {
    const checkpoint = await readEpochExpiry(client, packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved, 'NATIVE_SALE_RETIREMENT')
    const conflict = await proveExplicitGasConflict({ ...proof, maxCheckpoint: checkpoint.sequenceNumber, candidate, saved: saved?.conflict })
    await assertOriginalMissing()
    return { ...checkpoint, conflict }
  }
  const sequence = saved ? Number(saved.sequenceNumber) : undefined
  check(sequence === undefined || Number.isSafeInteger(sequence) && sequence >= 0, 'NATIVE_SALE_RETIREMENT_SEQUENCE')

  const response = await profileReadStep(signal, () => fetchSnapshot(endpoint, {
    method: 'POST', signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { checkpoint: sequence ?? null, coin: gas.objectId, digest: packet.digest } }),
  }))
  check(response.ok, 'NATIVE_SALE_RETIREMENT_INDEX_UNAVAILABLE')
  const text = await profileReadStep(signal, () => response.text())
  check(text.length > 0 && text.length <= 20000, 'NATIVE_SALE_RETIREMENT_INDEX_BOUND')
  const snapshot = JSON.parse(text) as Snapshot, selected = snapshot.data?.checkpoint
  check(!snapshot.errors && snapshot.data?.chainIdentifier === MAINNET_GENESIS_DIGEST && selected
    && Number.isSafeInteger(selected.sequenceNumber) && selected.sequenceNumber! >= 0
    && Number.isSafeInteger(selected.epoch?.epochId) && BigInt(selected.epoch!.epochId!) > BigInt(packet.expirationEpoch)
    && typeof selected.digest === 'string' && (sequence === undefined || sequence === selected.sequenceNumber),
  'NATIVE_SALE_RETIREMENT_INDEX_CHECKPOINT')
  check(selected.query?.transaction === null, 'NATIVE_SALE_RETIREMENT_INDEX_ORIGINAL_FOUND')
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
  const conflict = unchanged ? undefined : await proveExplicitGasConflict({ ...proof, maxCheckpoint: checkpoint.sequenceNumber,
    candidate: { version, digest: object.digest, writer: raw.previousTransaction } })
  await assertOriginalMissing()
  return conflict ? { ...checkpoint, conflict } : checkpoint

  async function assertOriginalMissing() {
    const original = await queryOriginal()
    check(original.status === 'MISSING', 'NATIVE_SALE_RETIREMENT_ORIGINAL_FOUND')
    signal.throwIfAborted()
  }
}
