import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { marketListDigest } from '../../animacraft/market-list-operation'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalSpentSuiCoin } from '../../sui/historical-object'
import { commerceCheck as check, decodeCommerce } from './economics-read'

type Transaction = Awaited<ReturnType<typeof readHistoricalParentTransaction>> & { refs: Ref[] }
type Ref = { objectId: string; version: string | number; digest: string }
type Pointer = { version: string; digest: string; writer: string }
export interface NativeSaleGasConflict {
  digest: string
  checkpoint: string
  coinId: string
}
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const sameRef = (a: Ref, b: Ref) => a.objectId === b.objectId && String(a.version) === String(b.version) && a.digest === b.digest

function consumedInput(transaction: Transaction, ref: Ref) {
  const e = transaction.effects.V2!, change = e.changedObjects.find(([id]) => id === ref.objectId)?.[1]
  const input = change?.inputState.Exist
  if (!input || String(input[0][0]) !== String(ref.version) || input[0][1] !== ref.digest
    || !input[1].AddressOwner || BigInt(e.lamportVersion) <= BigInt(ref.version)) return false
  if (!(change.idOperation.$kind === 'None' && change.outputState.$kind === 'ObjectWrite'
    || change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist')) return false
  return transaction.refs.some(row => sameRef(row, ref))
}

export async function proveNativeSaleSpentGas(input: {
  client: SuiGrpcClient; signal: AbortSignal; originalDigest: string; author: string; maxCheckpoint: string; gasRefs: Ref[]
  candidate: string | Pointer; saved?: NativeSaleGasConflict
}) {
  const { client, signal, originalDigest, author, maxCheckpoint, gasRefs, candidate, saved } = input
  const read = async (digest: string, checkpoint: string): Promise<Transaction> => {
    check(marketListDigest(digest) && digest !== originalDigest, 'NATIVE_SALE_CONFLICT_DIGEST')
    const transaction = await readHistoricalParentTransaction({ client, signal, transactionDigest: digest,
      maxCheckpoint: checkpoint, chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST })
    const { gasData } = bcs.TransactionData.parse(transaction.transactionBytes).V1
    return { ...transaction, refs: [...gasData.payment, ...transaction.ownedInputs] }
  }
  const readInput = (tx: Transaction, objectId: string) =>
    readHistoricalSpentSuiCoin({ client, signal, effects: tx.effects, transactionDigest: tx.transactionDigest, objectId })
  const certify = async (tx: Transaction, ref: Ref, coin?: Awaited<ReturnType<typeof readInput>>) => {
    check(consumedInput(tx, ref), 'NATIVE_SALE_CONFLICT_INPUT')
    const source = coin ?? await readInput(tx, ref.objectId)
    check(String(source.reference.version) === String(ref.version) && source.reference.digest === ref.digest
      && source.object.owner.AddressOwner === author && decodeCommerce(Coin, source.bytes).id === ref.objectId, 'NATIVE_SALE_CONFLICT_COIN')
    const evidence = { digest: tx.transactionDigest, checkpoint: tx.checkpoint, coinId: ref.objectId }
    check(!saved || saved.digest === evidence.digest && saved.checkpoint === evidence.checkpoint && saved.coinId === evidence.coinId,
      'NATIVE_SALE_CONFLICT_STORED')
    return evidence
  }

  if (typeof candidate === 'string') {
    const tx = await read(candidate, maxCheckpoint)
    const ref = gasRefs.find(ref => (!saved || ref.objectId === saved.coinId) && consumedInput(tx, ref))
    check(ref, 'NATIVE_SALE_CONFLICT_INPUT')
    return certify(tx, ref)
  }

  const primary = gasRefs[0]
  let pointer = candidate, upperCheckpoint = maxCheckpoint
  for (let hop = 0; hop < 8; hop++) {
    signal.throwIfAborted()
    const tx = await read(pointer.writer, upperCheckpoint)
    const effects = tx.effects.V2!, change = effects.changedObjects.find(([id]) => id === primary.objectId)?.[1]
    check(change?.idOperation.$kind === 'None' && change.outputState.ObjectWrite?.[0] === pointer.digest
      && effects.lamportVersion === pointer.version, 'NATIVE_SALE_CONFLICT_OUTPUT')
    const coin = await readInput(tx, primary.objectId)
    const predecessor = { objectId: primary.objectId, version: String(coin.reference.version), digest: coin.reference.digest }
    check(consumedInput(tx, predecessor) && coin.reference.version >= BigInt(primary.version), 'NATIVE_SALE_CONFLICT_LINEAGE')
    if (coin.reference.version === BigInt(primary.version)) return certify(tx, primary, coin)
    pointer = { version: predecessor.version, digest: predecessor.digest, writer: coin.object.previousTransaction }
    upperCheckpoint = tx.checkpoint
  }
  throw Error('COMMERCE_NATIVE_SALE_CONFLICT_HISTORY_BOUND')
}
