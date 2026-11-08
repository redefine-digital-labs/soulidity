import type { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase58, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { assertAddressBalanceEffects } from '../sui/address-balance-effects'
import { check, digest, uint } from './collection-command-plan'

const SUI = normalizeStructTag('0x2::sui::SUI')
type GasTransaction = Pick<ReturnType<Transaction['getData']>, 'gasData' | 'expiration'>

export function setCollectionGasWindow(tx: Transaction, genesis: string, epoch: bigint) {
  const maxEpoch = String(epoch + 1n)
  tx.setExpiration({ ValidDuring: {
    chain: genesis, minEpoch: String(epoch), maxEpoch, minTimestamp: null, maxTimestamp: null,
    nonce: crypto.getRandomValues(new Uint32Array(1))[0],
  } })
  return maxEpoch
}

/** The packet keeps its existing upper bound field. New bytes also commit a
 * lower bound and full chain ID. Legacy Epoch packets require actual gas coins. */
export function readCollectionGasWindow(tx: GasTransaction, expirationEpoch: string, shortChain: string, genesis?: string) {
  const gas = tx.gasData.payment
  check(gas && gas.length <= 256, 'GAS_REQUIRED')
  const valid = tx.expiration?.ValidDuring
  if (!valid) {
    check(gas.length > 0 && tx.expiration?.$kind === 'Epoch'
      && String(tx.expiration.Epoch) === expirationEpoch, 'PACKET_AUTHORITY')
    return { min: 0n, max: BigInt(expirationEpoch) }
  }

  digest(valid.chain)
  uint(valid.minEpoch)
  uint(valid.maxEpoch)
  const min = BigInt(valid.minEpoch), max = BigInt(valid.maxEpoch)
  check(toHex(fromBase58(valid.chain).subarray(0, 4)) === shortChain && (genesis === undefined || valid.chain === genesis)
    && valid.maxEpoch === expirationEpoch && max === min + 1n
    && valid.minTimestamp === null && valid.maxTimestamp === null, 'PACKET_AUTHORITY')
  return { min, max }
}

/** These effects are independent of the Collection Right's USDC settlement. */
export function collectionAddressGasIds(effects: ReturnType<typeof bcs.TransactionEffects.parse>,
  transactionDigest: string, owner: string, budget: string | number) {
  const e = effects.V2
  check(e && e.gasObjectIndex === null, 'HISTORY_GAS_INDEX')
  const { computationCost, storageCost, storageRebate } = e.gasUsed
  const charge = BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate)
  check(charge <= BigInt(budget), 'HISTORY_GAS_AMOUNT')
  return assertAddressBalanceEffects({ effects, transactionDigest,
    changes: [{ owner, coinType: SUI, delta: String(-charge), touched: true }],
  }).accumulatorIds
}
