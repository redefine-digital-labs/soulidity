'use client'

import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useRef } from 'react'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import {
  confirmPaidIncomePurchase, readCurrentPaidIncomeAfterPurchase, type ConfirmedPaidIncomePurchase,
} from '../../lib/soulidity/commerce/paid-income-ledger-reconciliation'

type Result = Exclude<Awaited<ReturnType<typeof confirmPaidIncomePurchase>>, ConfirmedPaidIncomePurchase>
  | Awaited<ReturnType<typeof readCurrentPaidIncomeAfterPurchase>>
const empty = {
  confirmed: null as ConfirmedPaidIncomePurchase | null,
  result: null as Result | null,
  error: null as string | null,
  pending: false, stopped: false,
}

export function PaidIncomePurchaseReadback({ client, soulId, purchaseText }: {
  client: SuiGrpcClient; soulId: string; purchaseText: string
}) {
  const session = useCommittedSession(purchaseText, soulId, client, null)
  const [view, setView] = useSessionState(session, empty)
  const active = useRef<AbortController | null>(null)

  async function query() {
    const lease = session.capture()
    if (!lease?.matches() || (active.current && !active.current.signal.aborted)) return
    const controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const current = () => lease.matches() && active.current === controller && !controller.signal.aborted
    let confirmed = view.confirmed
    setView({ ...empty, confirmed, pending: true })
    try {
      if (!confirmed) {
        const original = await confirmPaidIncomePurchase({ client, soulId, purchaseText, signal: controller.signal })
        if (!current()) return
        if (original.status !== 'PAID_INCOME_PURCHASE_CONFIRMED') {
          setView({ ...empty, result: original })
          return
        }
        confirmed = original
        setView({ ...empty, confirmed, pending: true })
      }
      const result = await readCurrentPaidIncomeAfterPurchase({ client, confirmed, signal: controller.signal })
      if (current()) setView({ ...empty, confirmed, result })
    } catch (error) {
      if (current()) setView({ ...empty, confirmed,
        error: error instanceof Error ? error.message : '付费入账暂无法核对。' })
    } finally {
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
    }
  }

  function stop() {
    active.current?.abort()
    active.current = null
    setView(previous => ({ ...empty, confirmed: previous.confirmed, stopped: true }))
  }

  const purchase = view.confirmed?.purchase
  const result = view.result
  return <section aria-label="原付费入账与当前账本" className="space-y-2">
    <h3 className="font-semibold">核对原付费入账与当前账本</h3>
    <button type="button" className="rounded border px-3 py-1" disabled={view.pending} onClick={() => void query()}>
      {purchase ? '重新读取原购买对应的当前账本' : '核对原购买与当前账本'}
    </button>
    {view.pending && <><p role="status">{purchase ? '正在读取原购买对应的当前账本…' : '正在核对原付费入账…'}</p>
      <button type="button" onClick={stop}>停止原付费入账核对</button></>}
    {view.stopped && <p role="status">已停止本次读取，可按同一原购买继续核对。</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {purchase && <article aria-label="已核验原付费入账" className="space-y-1 break-all">
      <p>原购买 {purchase.transactionDigest} · 检查点 {purchase.checkpoint}</p>
      <p>原协议入账（最小单位）{purchase.money.protocolIncome} · 币种 {purchase.money.coinType}</p>
      <p>入账后 Config {purchase.money.platformLedger.after.configId} · 版本 {purchase.money.platformLedger.after.version}</p>
    </article>}
    {result?.status === 'PAID_INCOME_PURCHASE_LEDGER_OBSERVED' && <article aria-label="原购买对应的当前协议账本" className="space-y-1 break-all">
      <p>当前账本余额（最小单位）{result.current.balance} · 对象版本 {result.current.version}</p>
      <p>累计入账 {result.current.collected} · 累计提款 {result.current.withdrawn}</p>
      {result.purchaseToCurrent.kind === 'INTERVENING_CONFIG_WRITES'
        && <p>原购买后共用账本新增入账 {result.purchaseToCurrent.collectedDelta} · 提款 {result.purchaseToCurrent.withdrawnDelta}</p>}
      <p>余额属于共用协议账本。提款须核对当前 Config 和操作钱包权限。</p>
      <a href="/income">打开协议收益入口核对提款权限</a>
    </article>}
    {result?.status === 'PAID_INCOME_CURRENT_UNVERIFIED' && <p role="alert">{result.reason === 'CONFIG_REFERENCE_CONFLICT'
      ? '当前账本引用与原付费入账不连续，可重新读取。' : '当前协议账本暂不可读，可重新读取。'}</p>}
    {result && 'stage' in result && <p role="status">{result.status === 'MISSING'
      ? '暂未查到原购买。请保留原摘要继续核对。' : result.status === 'PENDING'
        ? '原购买仍待终局确认。' : '原购买已在链上确认失败。'}</p>}
  </section>
}
