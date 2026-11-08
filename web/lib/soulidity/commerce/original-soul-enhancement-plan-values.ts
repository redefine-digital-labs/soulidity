import { fromBase58, toBase58 } from '@mysten/sui/utils'
/** Pure record/plan values. No Product/current reads, Host, wallet or source installation. */
export type OriginalSoulEnhancementCoinRef = { objectId: string; version: string; digest: string }
export interface UnsignedOriginalSoulEnhancementAccess {
  kind: 'BUY' | 'CLAIM'; product: { objectId: string; initialSharedVersion: string }; version: string; policyHash: string; attemptHex: string; amount: string
}
const MAX = (1n << 64n) - 1n
const commerceId = (v: string) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
function check(v: unknown, code: string): asserts v { if (!v) throw Error('SOUL_ENHANCEMENT_FUNDING_' + code) }
export function validateOriginalSoulEnhancementCoinRefs(coins: OriginalSoulEnhancementCoinRef[], excludedIds: string[] = []) {
  check(Array.isArray(coins) && coins.length <= 256 && new Set(coins.map(c => c.objectId)).size === coins.length, 'COINS')
  for (const ref of coins) {
    check(commerceId(ref.objectId) && !excludedIds.includes(ref.objectId) && typeof ref.version === 'string' && /^[1-9][0-9]{0,19}$/.test(ref.version)
      && BigInt(ref.version) <= MAX && typeof ref.digest === 'string' && ref.digest.length <= 44, 'REFERENCE')
    const bytes = fromBase58(ref.digest); check(bytes.length === 32 && toBase58(bytes) === ref.digest, 'DIGEST')
  }
}
