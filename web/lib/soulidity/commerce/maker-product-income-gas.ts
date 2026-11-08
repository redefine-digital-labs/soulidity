import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readTransactionGasWindow } from '../../sui/transaction-gas-window'
import { readCommerceAddressFunds } from './address-funds-read'
import { commerceCheck } from './economics-read'

type GasTransaction = Pick<ReturnType<Transaction['getData']>, 'expiration' | 'gasData'>
const SUI = '0x2::sui::SUI'

export function readMakerProductIncomeGasWindow(tx: GasTransaction, actor: string, expirationEpoch: string) {
  const window = readTransactionGasWindow(tx, MAINNET_GENESIS_DIGEST, expirationEpoch)
  if (!window || !window.addressGas) {
    return tx.expiration?.Epoch !== undefined && Number.isSafeInteger(Number(tx.expiration.Epoch)) ? window : null
  }
  const { owner, budget, price } = tx.gasData
  return owner === actor && budget && BigInt(budget) > 0n && price && BigInt(price) > 0n ? window : null
}

export async function readMakerProductIncomeAddressGas(client: SuiGrpcClient, actor: string, getActorAddress: () => string | null, signal: AbortSignal) {
  const funds = await readCommerceAddressFunds({ client, owner: actor, coinType: SUI, getObservedAddress: getActorAddress, signal })
  return funds.addressBalance
}

export async function requireMakerProductIncomeAddressGas(client: SuiGrpcClient, actor: string, getActorAddress: () => string | null, signal: AbortSignal, budget: string) {
  const balance = await readMakerProductIncomeAddressGas(client, actor, getActorAddress, signal)
  commerceCheck(BigInt(balance) >= BigInt(budget), 'MAKER_INCOME_ADDRESS_GAS_BALANCE')
  return balance
}
