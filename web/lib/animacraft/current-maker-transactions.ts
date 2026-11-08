import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { fromHex, normalizeStructTag, fromBase58, toBase58 } from '@mysten/sui/utils'
import type { PinnedMovePackage } from '../sui/pinned-move-package'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'

/** Current independent Maker service. No Native issuer or environment fallback.
 * These are unsigned PTBs; package pins are expectations, not live attestation.
 * Wallet/preflight, durable packet recovery and effects verification belong to
 * the integrating controller. Never use this composer to replay historical v8.
 */
export interface CurrentMakerTarget {
  chainIdentifier: typeof MAINNET_GENESIS_DIGEST
  manufacturing: PinnedMovePackage
  configId: string
  walrusSystemId: string
  paymentCoinType: string
}
type ProductVersion = { productId: string; version: string }
type AccessIntent = ProductVersion & { policyHash: string; feeRevision: string; expiryMs: string; attempt: string }
export type CurrentMakerAction =
  | { kind: 'CREATE_MAKER'; royaltyBps: number }
  | { kind: 'CREATE_PACK'; makerId: string; parentVersion: string; controlId: string; royaltyBps: number }
  | ({ kind: 'CLAIM_ACCESS' } & AccessIntent)
  | ({ kind: 'BUY_ACCESS'; payment: { amount: string; coinIds: string[] } } & AccessIntent)
  | (ProductVersion & { kind: 'CREATE_PLAYER'; feeRevision: string; expiryMs: string; attempt: string })
  | (ProductVersion & { kind: 'PAUSE' | 'ARCHIVE' | 'RESUME'; controlId: string })
  | { kind: 'CLOSE_PLAYER'; playerId: string; expectedRevision: string }
  | { kind: 'WITHDRAW_INCOME'; productId: string; controlId: string; expectedRevision: string; amount: string; recipient: string; attempt: string }

const maxU64 = (1n << 64n) - 1n
function check(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(`CURRENT_MAKER_INVALID: ${detail}`)
}
function id(value: unknown): string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'canonical nonzero ID required')
  return value
}
function u64(value: unknown, positive = false): string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value), 'exact decimal u64 required')
  check(BigInt(value) <= maxU64 && (!positive || BigInt(value) > 0n), 'u64 range')
  return value
}
function hex(value: unknown, bytes: number): number[] {
  check(typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value), `exact ${bytes}-byte hex required`)
  return Array.from(fromHex(value))
}
function royalty(value: number): number {
  // maker_catalog::assert_native_royalty applies to Product control rights.
  check(Number.isInteger(value) && value >= 0 && value <= 1000 && value % 50 === 0, 'control royalty 0..1000 bps in steps of 50')
  return value
}
export { id as currentMakerId, u64 as currentMakerU64, hex as currentMakerHex }
export function validateCurrentMakerPackage(input: PinnedMovePackage): PinnedMovePackage {
  const pin = structuredClone(input)
  id(pin.originalPackageId); id(pin.callablePackageId)
  const digest = pin.callableDigest
  check(typeof digest === 'string' && digest.length <= 44, 'package digest required')
  try { check(fromBase58(digest).length === 32 && toBase58(fromBase58(digest)) === digest, 'package digest invalid') }
  catch { throw new Error('CURRENT_MAKER_INVALID: package digest invalid') }
  return pin
}
export function validateCurrentMakerTarget(value: CurrentMakerTarget): CurrentMakerTarget {
  const target = structuredClone(value)
  check(target.chainIdentifier === MAINNET_GENESIS_DIGEST, 'mainnet genesis required')
  target.manufacturing = validateCurrentMakerPackage(target.manufacturing)
  id(target.configId); id(target.walrusSystemId)
  check(typeof target.paymentCoinType === 'string' && normalizeStructTag(target.paymentCoinType) === target.paymentCoinType,
    'canonical payment type required')
  return target
}

/** Same IDs/versions apply to both Maker and Pack access. A Pack entitlement
 * grants pre-Complete use, not an issued component or equipment on an old Soul.
 * A repeated purchase aborts in Maker; controllers must query access first.
 */
export function buildCurrentMakerTransaction(input: { target: CurrentMakerTarget; sender: string; action: CurrentMakerAction }): Transaction {
  const target = validateCurrentMakerTarget(input.target), sender = id(input.sender)
  const action = structuredClone(input.action), tx = new Transaction()
  tx.setSender(sender)
  const call = (module: string, fn: string, args: TransactionArgument[], generic = true) => tx.moveCall({
    target: `${target.manufacturing.callablePackageId}::${module}::${fn}`,
    typeArguments: generic ? [target.paymentCoinType] : [], arguments: args,
  })
  const object = (value: string) => tx.object(id(value))
  const number = (value: string, positive = false) => tx.pure.u64(u64(value, positive))
  const bytes = (value: string, length: number) => tx.pure.vector('u8', hex(value, length))
  const config = () => object(target.configId), system = () => object(target.walrusSystemId), clock = () => tx.object('0x6')
  switch (action.kind) {
    case 'CREATE_MAKER':
      call('maker_factory', 'create_maker', [config(), tx.pure.u16(royalty(action.royaltyBps)), system()]); break
    case 'CREATE_PACK':
      check(action.makerId !== action.controlId, 'Maker and Control must differ')
      call('maker_factory', 'create_pack', [object(action.makerId), number(action.parentVersion, true), object(action.controlId),
        config(), tx.pure.u16(royalty(action.royaltyBps)), system()]); break
    case 'CLAIM_ACCESS': case 'BUY_ACCESS': {
      const args = [object(action.productId), config(), number(action.version, true), bytes(action.policyHash, 32),
        number(action.feeRevision), number(action.expiryMs, true), bytes(action.attempt, 32)]
      if (action.kind === 'BUY_ACCESS') {
        const amount = u64(action.payment.amount, true), coins = action.payment.coinIds.map(id)
        check(coins.length > 0 && coins.length <= 256 && new Set(coins).size === coins.length, 'unique payment coins required')
        check(!coins.includes(action.productId) && !coins.includes(target.configId) && !coins.includes(target.walrusSystemId), 'payment object role alias')
        const primary = object(coins[0])
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(object))
        // Selected Coin<C> objects are resolved/checked by normal Sui preflight.
        // Split exactly the quoted gross; unspent balance stays with the owner.
        const [payment] = tx.splitCoins(primary, [tx.pure.u64(amount)])
        args.push(payment)
      }
      call('maker_factory', action.kind === 'BUY_ACCESS' ? 'buy_access' : 'claim_access', [...args, system(), clock()]); break
    }
    case 'CREATE_PLAYER':
      call('maker_factory', 'create_player', [object(action.productId), config(), number(action.version, true),
        number(action.feeRevision), number(action.expiryMs, true), bytes(action.attempt, 32), system(), clock()]); break
    case 'PAUSE': case 'ARCHIVE': case 'RESUME':
      check(action.productId !== action.controlId, 'Product and Control must differ')
      call('maker_release', action.kind.toLowerCase(), [object(action.productId), object(action.controlId),
        ...(action.kind === 'RESUME' ? [config()] : []), number(action.version, true),
        ...(action.kind === 'RESUME' ? [system()] : [])]); break
    case 'CLOSE_PLAYER':
      // Legitimate exit remains possible while the product/service is paused.
      call('maker_player', 'close', [object(action.playerId), number(action.expectedRevision)], false); break
    case 'WITHDRAW_INCOME':
      check(action.productId !== action.controlId, 'Product and Control must differ')
      // Current Control, ledger CAS and attempt are enforced by the real owner.
      // Legal withdrawal does not consult service lifecycle or current fees.
      call('maker_catalog', 'withdraw_income', [object(action.productId), object(action.controlId),
        number(action.expectedRevision), number(action.amount, true), tx.pure.address(id(action.recipient)), bytes(action.attempt, 32)]); break
    default: throw new Error('CURRENT_MAKER_INVALID: unsupported action; legacy recovery requires its original composer')
  }
  return tx
}

/** Query the original attempt before any new payment. Missing view data alone
 * is never proof that an already signed transaction failed or may be replaced.
 * Transaction/effects reconciliation remains the original packet's controller.
 */
export function buildCurrentMakerAttemptRead(input: { target: CurrentMakerTarget; sender: string; productId: string;
  operation: 'ACCESS' | 'COMPLETE'; attempt: string }): Transaction {
  const target = validateCurrentMakerTarget(input.target), tx = new Transaction()
  tx.setSender(id(input.sender))
  check(input.operation === 'ACCESS' || input.operation === 'COMPLETE', 'attempt operation required')
  const args = [tx.object(id(input.productId)), tx.pure.address(input.sender), tx.pure.u8(input.operation === 'ACCESS' ? 1 : 2),
    tx.pure.vector('u8', hex(input.attempt, 32))]
  for (const fn of ['receipt', 'payment_receipt']) tx.moveCall({
    target: `${target.manufacturing.callablePackageId}::maker_catalog::${fn}`,
    typeArguments: [target.paymentCoinType], arguments: args,
  })
  return tx
}

/** Public view calls for entitlement checks and quotes; no private BCS layout.
 * Interpret their return values only after successful current-chain simulation.
 * access_held alone is insufficient: assert_access_entitlement validates the
 * holder, version, policy hash, manifest, paid amount and current lifecycle.
 */
export function buildCurrentMakerAccessRead(input: { target: CurrentMakerTarget; sender: string; productId: string;
  version: string; quote?: { attempt: string; expiryMs: string }; assertEntitlement?: boolean }): Transaction {
  const target = validateCurrentMakerTarget(input.target), tx = new Transaction()
  tx.setSender(id(input.sender))
  const call = (fn: string, args: TransactionArgument[]) => tx.moveCall({
    target: `${target.manufacturing.callablePackageId}::maker_catalog::${fn}`,
    typeArguments: [target.paymentCoinType], arguments: args,
  })
  const product = tx.object(id(input.productId)), version = tx.pure.u64(u64(input.version, true)), actor = tx.pure.address(input.sender)
  call('access_record', [product, version, actor])
  if (input.assertEntitlement) call('assert_access_entitlement', [product, version, actor])
  if (input.quote) call('access_quote', [product, tx.object(target.configId), version, actor,
    tx.pure.vector('u8', hex(input.quote.attempt, 32)), tx.pure.u64(u64(input.quote.expiryMs, true))])
  return tx
}
