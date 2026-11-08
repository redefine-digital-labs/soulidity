import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject } from './economics-read'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
/** Wallet discovery supplies candidate IDs only. Actual same-chain full Coin
 * objects establish owner/currency/balance and frozen version+digest. Never
 * reads legacy mirrors, cached JSON balances or spends a gas input twice.
 * This is an observation, not a reservation: recheck before signature/resend.
 */
type FundingInput = { client: SuiGrpcClient; buyer: string; coinType: string; total: string;
  coinIds: string[]; gasCoinIds: string[]; getBuyerAddress: () => string | null; signal: AbortSignal }

export async function readNativeSaleFunding(input: FundingInput) {
  commerceCheck(input.gasCoinIds.length > 0, 'SALE_FUNDING_SCOPE')
  return readSaleCoins(input)
}

export async function readNativeSaleGasCoins(input: Omit<FundingInput, 'coinType' | 'gasCoinIds'>) {
  return (await readSaleCoins({ ...input, coinType: '0x2::sui::SUI', gasCoinIds: [] })).coins
    .map(({ objectId, version, digest }) => ({ objectId, version, digest }))
}

async function readSaleCoins(input: FundingInput) {
  const buyer = input.buyer, coinType = normalizeStructTag(input.coinType), ids = [...input.coinIds], gasIds = [...input.gasCoinIds], required = input.total
  const { client } = input, signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const guard = () => { signal.throwIfAborted(); commerceCheck(input.getBuyerAddress() === buyer, 'SALE_FUNDING_WALLET_CHANGED') }
  commerceCheck(commerceId(buyer) && /^[1-9][0-9]{0,19}$/.test(required) && BigInt(required) <= 18446744073709551615n
    && ids.length > 0 && ids.length <= 256 && gasIds.length <= 256 && ids.every(commerceId) && gasIds.every(commerceId)
    && new Set([...ids, ...gasIds]).size === ids.length + gasIds.length, 'SALE_FUNDING_SCOPE')
  guard()
  const chain = await profileReadStep(signal, () => client.core.getChainIdentifier())
  commerceCheck(toHex(fromBase58(chain.chainIdentifier).subarray(0, 4)) === '35834a8a', 'SALE_FUNDING_CHAIN')
  const coins: Array<{ objectId: string; version: string; digest: string; balance: string }> = []
  let total = 0n
  for (const id of ids) {
    guard(); const object = await readCommerceObject(client, id, `0x2::coin::Coin<${coinType}>`, signal), coin = decodeCommerce(Coin, object.contents)
    commerceCheck(object.owner.AddressOwner === buyer && coin.id === id && BigInt(coin.balance) > 0n, 'SALE_FUNDING_COIN')
    total += BigInt(coin.balance)
    commerceCheck(total <= 18446744073709551615n, 'SALE_FUNDING_MERGE_OVERFLOW')
    coins.push({ objectId: id, version: object.version, digest: object.digest, balance: coin.balance })
  }
  commerceCheck(total >= BigInt(required), 'SALE_FUNDING_INSUFFICIENT')
  for (const coin of coins) { guard(); const current = await readCommerceObject(client, coin.objectId, `0x2::coin::Coin<${coinType}>`, signal)
    commerceCheck(current.version === coin.version && current.digest === coin.digest, 'SALE_FUNDING_CHANGED') }
  guard()
  return { proof: 'native-sale-current-payment-coins-only' as const, buyer, coinType, required,
    verifiedBalance: String(total), coins, gasCoinIds: gasIds, notReservedOrPaid: true as const }
}
