import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject } from './economics-read'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
/** Current observations of original payout Coin IDs. Parent first proves the
 * original payout; a supplied ID/amount is not historical payment evidence.
 * Coin balance can change after merging/splitting. Missing is unavailable,
 * never zero, spent, or permission to repeat payment. No wallet-total claim.
 */
export async function readCommercePayoutCoins(input: { client: SuiGrpcClient; owner: string; coinType: string;
  payouts: Array<{ coinId: string; amount: string }>; getViewerAddress: () => string | null; signal: AbortSignal }) {
  const owner = input.owner, coinType = normalizeStructTag(input.coinType), payouts = structuredClone(input.payouts)
  const source=input.client,getViewerAddress=input.getViewerAddress
  const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const guard = () => { signal.throwIfAborted(); commerceCheck(getViewerAddress() === owner, 'PAYOUT_WALLET_CHANGED') }
  commerceCheck(commerceId(owner) && payouts.length > 0 && payouts.length <= 256
    && payouts.every(p => commerceId(p.coinId) && /^[1-9][0-9]{0,19}$/.test(p.amount) && BigInt(p.amount) <= (1n << 64n) - 1n)
    && new Set(payouts.map(p => p.coinId)).size === payouts.length, 'PAYOUT_SCOPE')
  guard()
  const chain = await profileReadStep(signal, () => client.core.getChainIdentifier())
  commerceCheck(chain.chainIdentifier === MAINNET_GENESIS_DIGEST, 'PAYOUT_CHAIN')
  const observations = []
  for (const payout of payouts) {
    guard()
    try {
      const object = await readCommerceObject(client, payout.coinId, `0x2::coin::Coin<${coinType}>`, signal)
      const coin = decodeCommerce(Coin, object.contents)
      commerceCheck(coin.id === payout.coinId, 'PAYOUT_COIN_ID')
      guard()
      const rechecked = await readCommerceObject(client, payout.coinId, `0x2::coin::Coin<${coinType}>`, signal)
      commerceCheck(rechecked.version === object.version && rechecked.digest === object.digest, 'PAYOUT_CHANGED')
      observations.push({ coinId: payout.coinId, originalAmount: payout.amount, status: object.owner.AddressOwner === owner
        ? 'CURRENTLY_OWNED' as const : 'OTHER_OWNER' as const, currentCoinBalance: coin.balance,
        reference: { version: object.version, digest: object.digest } })
    } catch (error) {
      guard()
      // NOT_FOUND on the initial or recheck read does not prove deletion or
      // that the original payment failed. All other errors remain errors.
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'NOT_FOUND' || error.code === 5)) {
        observations.push({ coinId: payout.coinId, originalAmount: payout.amount, status: 'UNAVAILABLE' as const })
      } else throw error
    }
  }
  guard()
  return { proof: 'commerce-current-original-payout-coin-observations-only' as const, owner, coinType, observations,
    notOriginalPaymentProof: true as const, notWalletTotal: true as const, notRevenueAttribution: true as const,
    notAuthorityOrRetryPermission: true as const }
}
