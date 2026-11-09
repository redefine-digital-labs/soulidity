import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import type { EpochCheckpoint } from '../../sui/epoch-checkpoint'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck as check } from './economics-read'

const endpoint = 'https://graphql.mainnet.sui.io/graphql'
const query = `query CommerceRetirement($checkpoint: UInt53, $coin: SuiAddress!, $digest: String!) {
  chainIdentifier
  checkpoint(sequenceNumber: $checkpoint) {
    sequenceNumber digest epoch { epochId }
    query { object(address: $coin) { address version digest objectBcs } transaction(digest: $digest) { digest } }
  }
}`
interface Snapshot {
  errors?: unknown
  data?: { chainIdentifier?: string; checkpoint?: {
    sequenceNumber?: number; digest?: string; epoch?: { epochId?: number };
    query?: { object?: { address?: string; version?: number; digest?: string; objectBcs?: string } | null; transaction?: { digest: string } | null }
  } }
}

/** Read one exact object and digest at the same indexed mainnet checkpoint.
 * The caller authenticates the object BCS and matches the gRPC checkpoint. */
export async function readIndexedRetirementSnapshot(input: {
  packet: PublicMutationPacket; saved?: EpochCheckpoint; objectId: string; signal: AbortSignal; prefix: string
}) {
  const { packet, saved, objectId, signal, prefix } = input
  const fetchSnapshot = globalThis.fetch
  const sequence = saved ? Number(saved.sequenceNumber) : undefined
  check(sequence === undefined || Number.isSafeInteger(sequence) && sequence >= 0, prefix + '_SEQUENCE')

  const response = await profileReadStep(signal, () => fetchSnapshot(endpoint, {
    method: 'POST', signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { checkpoint: sequence ?? null, coin: objectId, digest: packet.digest } }),
  }))
  check(response.ok, prefix + '_INDEX_UNAVAILABLE')
  const text = await profileReadStep(signal, () => response.text())
  check(text.length > 0 && text.length <= 20000, prefix + '_INDEX_BOUND')
  const snapshot = JSON.parse(text) as Snapshot, selected = snapshot.data?.checkpoint
  check(!snapshot.errors && snapshot.data?.chainIdentifier === MAINNET_GENESIS_DIGEST && selected
    && Number.isSafeInteger(selected.sequenceNumber) && selected.sequenceNumber! >= 0
    && Number.isSafeInteger(selected.epoch?.epochId) && BigInt(selected.epoch!.epochId!) > BigInt(packet.expirationEpoch)
    && typeof selected.digest === 'string' && (sequence === undefined || sequence === selected.sequenceNumber),
  prefix + '_INDEX_CHECKPOINT')
  const indexed = selected.query
  check(indexed?.transaction === null, prefix + '_INDEX_ORIGINAL_FOUND')
  return { ...selected, query: indexed }
}
