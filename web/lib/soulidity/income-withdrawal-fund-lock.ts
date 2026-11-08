import { incomeWithdrawalFundKeyV1, INCOME_WITHDRAWAL_PREFIX_V1, type IncomeWithdrawalFundScope } from './income-withdrawal-journal-v1'

const claims = new Set<string>()
export function incomeWithdrawalFundLockKey(scope: IncomeWithdrawalFundScope) {
  return 'soulidity.income-withdrawal-fund-operation:' + incomeWithdrawalFundKeyV1(scope).slice(INCOME_WITHDRAWAL_PREFIX_V1.length)
}
/** Same funds across actor/Admin/recipient/source; always acquired before head.
 * No abort race may release either lock ahead of an initiated durable boundary.
 */
export function withIncomeWithdrawalFundLock<T>(scope: IncomeWithdrawalFundScope, work: () => Promise<T>): Promise<T> {
  const key = incomeWithdrawalFundLockKey(scope)
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return Promise.reject(Error('WITHDRAW_FUND_REQUIRES_WEB_LOCKS'))
  if (claims.has(key)) return Promise.reject(Error('WITHDRAW_FUND_BUSY'))
  claims.add(key)
  try {
    return Promise.resolve(navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw Error('WITHDRAW_FUND_BUSY')
      return await work()
    })).finally(() => claims.delete(key))
  } catch (error) { claims.delete(key); return Promise.reject(error) }
}
