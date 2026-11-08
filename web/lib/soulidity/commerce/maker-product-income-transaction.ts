import { Transaction } from '@mysten/sui/transactions'
import { commerceCheck, commerceId } from './economics-read'
import { parseMakerProductIncomeTarget, type readMakerProductIncome } from './maker-product-income-read'

/** Pure unsigned exact current Maker/Pack withdrawal. Does not select Gas,
 * qualify deployment, persist, simulate, sign or authorize a new attempt.
 */
export function buildMakerProductIncomeWithdrawal(snapshot: Awaited<ReturnType<typeof readMakerProductIncome>>, request: { actor: string; recipient: string; amount: string; attempt: Uint8Array }) {
  const value = structuredClone(snapshot), input = structuredClone(request), target = parseMakerProductIncomeTarget(value.target)
  commerceCheck(commerceId(input.actor) && commerceId(input.recipient) && value.authority?.actor === input.actor && value.authority.objectId !== target.productId, 'MAKER_INCOME_BUILD_CONTROL')
  commerceCheck(/^[1-9][0-9]{0,19}$/.test(input.amount) && BigInt(input.amount) <= BigInt(value.ledger.balance) && BigInt(input.amount) <= 18446744073709551615n, 'MAKER_INCOME_BUILD_AMOUNT')
  commerceCheck(input.attempt instanceof Uint8Array && input.attempt.length === 32 && input.attempt.some(byte => byte !== 0), 'MAKER_INCOME_BUILD_ATTEMPT')
  commerceCheck(/^[1-9][0-9]{0,19}$/.test(value.initialSharedVersion) && BigInt(value.initialSharedVersion) <= 18446744073709551615n, 'MAKER_INCOME_BUILD_BIRTH')
  const tx = new Transaction(); tx.setSender(input.actor)
  tx.moveCall({ target: `${target.manufacturing.callablePackageId}::maker_catalog::withdraw_income`, typeArguments: [target.coinType], arguments: [
    tx.sharedObjectRef({ objectId: target.productId, initialSharedVersion: value.initialSharedVersion, mutable: true }),
    tx.objectRef({ objectId: value.authority.objectId, version: value.authority.version, digest: value.authority.digest }),
    tx.pure.u64(value.ledger.revision), tx.pure.u64(input.amount), tx.pure.address(input.recipient), tx.pure.vector('u8', Array.from(input.attempt)),
  ] })
  return tx
}
