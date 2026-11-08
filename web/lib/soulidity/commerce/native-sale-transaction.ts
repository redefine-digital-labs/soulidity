import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'

export interface NativeSalePurchase {
  callablePackage: string; coinType: string; offer: string; registry: string; config: string
  policy: string; sellerKiosk: string; buyerKiosk: string; buyerAccount: string
  generation: bigint; attempt: Uint8Array; expiryMs: bigint; collection?: string
}

/** Appends current public Native market calls to the caller's PTB. The caller
 * must attest deployment identity, freshness, wallet, policy and object ownership
 * before signing. No environment fallback and no signing/broadcast occur here.
 * Quote.total is read on-chain: an off-chain display estimate cannot underpay.
 * Supply a payment coin of the configured currency; its change remains in PTB.
 */
export function appendNativeSalePurchase(tx: Transaction, input: NativeSalePurchase,
  payment: TransactionObjectArgument) {
  const id = /^0x[0-9a-f]{64}$/
  for (const value of [input.callablePackage, input.offer, input.registry, input.config,
    input.policy, input.sellerKiosk, input.buyerKiosk, input.buyerAccount, ...(input.collection ? [input.collection] : [])]) {
    if (!id.test(value) || BigInt(value) === 0n) throw new Error('Exact Native market object ID required')
  }
  if (input.sellerKiosk === input.buyerKiosk || input.attempt.length < 1 || input.attempt.length > 64
    || typeof input.generation !== 'bigint' || typeof input.expiryMs !== 'bigint'
    || input.generation < 0n || input.generation > MAX_U64 || input.expiryMs <= 0n || input.expiryMs > MAX_U64) {
    throw new Error('Invalid Native purchase identity or attempt')
  }
  const coinType = normalizeStructTag(input.coinType)
  const target = (name: string) => `${input.callablePackage}::market::${name}` as `${string}::${string}::${string}`
  const clock = tx.object('0x6')
  const collectionArgs = input.collection ? [tx.object(input.collection)] : []
  const [quote] = tx.moveCall({ target: target(input.collection ? 'quote_with_collection' : 'quote'),
    typeArguments: [coinType], arguments: [tx.object(input.offer), tx.object(input.config), tx.object(input.policy),
      ...collectionArgs, tx.pure.u64(input.generation), tx.pure.vector('u8', Array.from(input.attempt)), tx.pure.u64(input.expiryMs), clock] })
  const [total] = tx.moveCall({ target: target('total'), arguments: [quote] })
  const [exactPayment] = tx.splitCoins(payment, [total])
  tx.moveCall({ target: target(input.collection ? 'buy_with_collection' : 'buy'), typeArguments: [coinType],
    arguments: [tx.object(input.offer), tx.object(input.registry), tx.object(input.config), tx.object(input.policy),
      ...collectionArgs, tx.object(input.sellerKiosk), tx.object(input.buyerKiosk), tx.object(input.buyerAccount),
      quote, exactPayment, clock] })
}

const MAX_U64 = (1n << 64n) - 1n
