import type { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { proveSuiAddressGas } from '../sui/address-balance-effects'
import { readTransactionGasWindow } from '../sui/transaction-gas-window'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { marketListCheck as check } from './market-list-operation'

type EquipmentGasPacket = { bytes: string; digest: string; expirationEpoch: string }

export function equipmentMarketGasPacket(packet: EquipmentGasPacket) {
  const tx = Transaction.from(fromBase64(packet.bytes)).getData()
  const window = readTransactionGasWindow(tx, MAINNET_GENESIS_DIGEST, packet.expirationEpoch)
  check(window, 'Equipment sender/gas/expiration mismatch')
  return { window, gas: tx.gasData }
}

export function proveEquipmentAddressGas(packet: EquipmentGasPacket, effects: ReturnType<typeof bcs.TransactionEffects.parse>) {
  const { window, gas } = equipmentMarketGasPacket(packet)
  check(window.addressGas && gas.owner && gas.budget, 'Equipment address gas packet required')
  return proveSuiAddressGas({ effects, transactionDigest: packet.digest, owner: gas.owner, budget: gas.budget })
}
