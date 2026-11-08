import type { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, toBase64 } from '@mysten/sui/utils'

type GasTransaction = Pick<ReturnType<Transaction['getData']>, 'expiration' | 'gasData'>

export function setTransactionGasWindow(tx: Transaction, genesis: string, epoch: bigint) {
  const maxEpoch = String(epoch + 1n)
  tx.setExpiration({ ValidDuring: {
    chain: genesis, minEpoch: String(epoch), maxEpoch, minTimestamp: null, maxTimestamp: null,
    nonce: crypto.getRandomValues(new Uint32Array(1))[0],
  } })
  return maxEpoch
}

/** Full-network expiration for SDK-selected address gas. Preserve legacy coin packets. */
export function readTransactionGasWindow(tx: GasTransaction, genesis: string, expectedMax: string) {
  const payment = tx.gasData.payment
  if (!payment || payment.length > 256) return null
  const expiration = tx.expiration, valid = expiration?.ValidDuring
  if (!valid) {
    return payment.length > 0 && expiration?.$kind === 'Epoch' && String(expiration.Epoch) === expectedMax
      ? { min: '0', max: expectedMax, addressGas: false } : null
  }
  if (valid.chain !== genesis || valid.minEpoch == null || valid.maxEpoch !== expectedMax
    || valid.minTimestamp !== null || valid.maxTimestamp !== null
    || BigInt(valid.maxEpoch) !== BigInt(valid.minEpoch) + 1n) return null
  return { min: String(valid.minEpoch), max: valid.maxEpoch, addressGas: payment.length === 0 }
}

export async function simulateExactAddressGas(client: SuiGrpcClient, bytes: string, signal: AbortSignal) {
  const { response } = await client.transactionExecutionService.simulateTransaction({
    transaction: { bcs: { value: fromBase64(bytes) } }, checks: 0, doGasSelection: false,
    readMask: { paths: ['transaction.transaction.bcs', 'transaction.effects.status'] },
  }, { abort: signal })
  const result = response.transaction, original = result?.transaction?.bcs?.value
  return original instanceof Uint8Array && toBase64(original) === bytes && result?.effects?.status?.success === true
}
