import { bcs } from '@mysten/sui/bcs'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalSpentSuiCoin } from '../../sui/historical-object'
import type { EpochCheckpoint } from '../../sui/epoch-checkpoint'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck as check, commerceId, decodeCommerce } from './economics-read'

type Transaction = Awaited<ReturnType<typeof readHistoricalParentTransaction>> & { refs: Ref[] }
type Ref = { objectId: string; version: string | number; digest: string }
type Pointer = { version: string; digest: string; writer: string }
export interface ExplicitGasConflict {
  digest: string
  checkpoint: string
  coinId: string
}
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const sameRef = (a: Ref, b: Ref) => a.objectId === b.objectId && String(a.version) === String(b.version) && a.digest === b.digest

export function readOriginalSuiGasReferences(packet: PublicMutationPacket, author: string, prefix: string) {
  check(packet.bytes.length > 0 && packet.bytes.length <= 180000, prefix + '_PACKET')
  const bytes = fromBase64(packet.bytes)
  check(TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, prefix + '_PACKET')
  const data = decodeCommerce(bcs.TransactionData, bytes).V1
  const refs = data.gasData.payment
  check(data.sender === author && data.gasData.owner === author && refs.length > 0 && refs.length <= 256
    && String(data.expiration.Epoch) === packet.expirationEpoch, prefix + '_GAS')
  return refs
}

export function validateExplicitGasConflict(conflict: ExplicitGasConflict, packet: PublicMutationPacket, checkpoint: EpochCheckpoint, prefix: string) {
  check(conflict && Object.keys(conflict).sort().join(',') === 'checkpoint,coinId,digest'
    && marketListDigest(conflict.digest) && conflict.digest !== packet.digest && commerceId(conflict.coinId)
    && typeof conflict.checkpoint === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(conflict.checkpoint)
    && BigInt(conflict.checkpoint) <= BigInt(checkpoint.sequenceNumber), prefix + '_CONFLICT')
}

export async function verifyExplicitGasConflict(input: {
  client: SuiGrpcClient; packet: PublicMutationPacket; author: string; checkpoint: EpochCheckpoint
  digest: string; signal: AbortSignal; prefix: string; saved?: ExplicitGasConflict
}) {
  const { client, packet, author, checkpoint, digest, signal, prefix, saved } = input
  const gasRefs = readOriginalSuiGasReferences(packet, author, prefix)
  return proveExplicitGasConflict({ client, signal, originalDigest: packet.digest, author, gasRefs,
    maxCheckpoint: checkpoint.sequenceNumber, candidate: digest, saved, prefix })
}

function consumedInput(transaction: Transaction, ref: Ref) {
  const e = transaction.effects.V2!, change = e.changedObjects.find(([id]) => id === ref.objectId)?.[1]
  const input = change?.inputState.Exist
  if (!input || String(input[0][0]) !== String(ref.version) || input[0][1] !== ref.digest
    || !input[1].AddressOwner || BigInt(e.lamportVersion) <= BigInt(ref.version)) return false
  if (!(change.idOperation.$kind === 'None' && change.outputState.$kind === 'ObjectWrite'
    || change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist')) return false
  return transaction.refs.some(row => sameRef(row, ref))
}

export async function proveExplicitGasConflict(input: {
  client: SuiGrpcClient; signal: AbortSignal; originalDigest: string; author: string; maxCheckpoint: string; gasRefs: Ref[]
  candidate: string | Pointer; saved?: ExplicitGasConflict; prefix?: string
}) {
  const { client, signal, originalDigest, author, maxCheckpoint, gasRefs, candidate, saved, prefix = 'NATIVE_SALE' } = input
  const read = async (digest: string, checkpoint: string): Promise<Transaction> => {
    check(marketListDigest(digest) && digest !== originalDigest, prefix + '_CONFLICT_DIGEST')
    const transaction = await readHistoricalParentTransaction({ client, signal, transactionDigest: digest,
      maxCheckpoint: checkpoint, chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST })
    const { gasData } = bcs.TransactionData.parse(transaction.transactionBytes).V1
    return { ...transaction, refs: [...gasData.payment, ...transaction.ownedInputs] }
  }
  const readInput = (tx: Transaction, objectId: string) =>
    readHistoricalSpentSuiCoin({ client, signal, effects: tx.effects, transactionDigest: tx.transactionDigest, objectId })
  const certify = async (tx: Transaction, ref: Ref, coin?: Awaited<ReturnType<typeof readInput>>) => {
    check(consumedInput(tx, ref), prefix + '_CONFLICT_INPUT')
    const source = coin ?? await readInput(tx, ref.objectId)
    check(String(source.reference.version) === String(ref.version) && source.reference.digest === ref.digest
      && source.object.owner.AddressOwner === author && decodeCommerce(Coin, source.bytes).id === ref.objectId, prefix + '_CONFLICT_COIN')
    const evidence = { digest: tx.transactionDigest, checkpoint: tx.checkpoint, coinId: ref.objectId }
    check(!saved || saved.digest === evidence.digest && saved.checkpoint === evidence.checkpoint && saved.coinId === evidence.coinId,
      prefix + '_CONFLICT_STORED')
    return evidence
  }

  if (typeof candidate === 'string') {
    const tx = await read(candidate, maxCheckpoint)
    const ref = gasRefs.find(ref => (!saved || ref.objectId === saved.coinId) && consumedInput(tx, ref))
    check(ref, prefix + '_CONFLICT_INPUT')
    return certify(tx, ref)
  }

  const primary = gasRefs[0]
  let pointer = candidate, upperCheckpoint = maxCheckpoint
  for (let hop = 0; hop < 8; hop++) {
    signal.throwIfAborted()
    const tx = await read(pointer.writer, upperCheckpoint)
    const effects = tx.effects.V2!, change = effects.changedObjects.find(([id]) => id === primary.objectId)?.[1]
    check(change?.idOperation.$kind === 'None' && change.outputState.ObjectWrite?.[0] === pointer.digest
      && effects.lamportVersion === pointer.version, prefix + '_CONFLICT_OUTPUT')
    const coin = await readInput(tx, primary.objectId)
    const predecessor = { objectId: primary.objectId, version: String(coin.reference.version), digest: coin.reference.digest }
    check(consumedInput(tx, predecessor) && coin.reference.version >= BigInt(primary.version), prefix + '_CONFLICT_LINEAGE')
    if (coin.reference.version === BigInt(primary.version)) return certify(tx, primary, coin)
    pointer = { version: predecessor.version, digest: predecessor.digest, writer: coin.object.previousTransaction }
    upperCheckpoint = tx.checkpoint
  }
  throw Error('COMMERCE_NATIVE_SALE_CONFLICT_HISTORY_BOUND')
}
