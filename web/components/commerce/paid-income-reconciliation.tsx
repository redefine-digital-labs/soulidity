'use client'

import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useRef } from 'react'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { createConfiguredIncomeOriginalExecutionRegistry } from '../../lib/soulidity/configured-income-entry'
import { importIncomeWithdrawalRecoveryRecord } from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import { reconcilePaidIncomeOriginals } from '../../lib/soulidity/commerce/paid-income-ledger-reconciliation'

type Result = Awaited<ReturnType<typeof reconcilePaidIncomeOriginals>>
const empty = {
  file: null as { name: string; text: string; digest: string } | null,
  pending: false, stopped: false, result: null as Result | null, error: null as string | null,
}

export function PaidIncomeReconciliation({ client, soulId, purchaseText }: {
  client: SuiGrpcClient; soulId: string; purchaseText: string
}) {
  const session = useCommittedSession(purchaseText, soulId, client, null)
  const [view, setView] = useSessionState(session, empty)
  const revision = useRef(0), active = useRef<AbortController | null>(null)

  async function select(file: File | undefined) {
    const lease = session.capture()
    if (!lease?.matches()) return
    const selected = ++revision.current
    active.current?.abort()
    active.current = null
    setView(empty)
    if (!file) return
    const current = () => lease.matches() && revision.current === selected
    try {
      if (file.size === 0 || file.size > 300000) throw Error('原提款文件超过大小上限或为空。')
      const text = await file.text()
      if (!current()) return
      if (new TextEncoder().encode(text).byteLength > 300000) throw Error('原提款文件超过大小上限。')
      const original = importIncomeWithdrawalRecoveryRecord(text)
      setView({ ...empty, file: { name: file.name, text, digest: original.packet.digest } })
    } catch (error) {
      if (current()) setView({ ...empty, error: error instanceof Error ? error.message : '无法读取原提款文件。' })
    }
  }

  function stop() {
    active.current?.abort()
    active.current = null
    setView({ ...empty, file: view.file, stopped: true })
  }

  async function query() {
    const lease = session.capture(), file = view.file
    if (!file || !lease?.matches() || (active.current && !active.current.signal.aborted)) return
    const controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const current = () => lease.matches() && active.current === controller && !controller.signal.aborted
    setView({ ...empty, file, pending: true })
    try {
      const { registry } = createConfiguredIncomeOriginalExecutionRegistry()
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(75000)])
      const result = await reconcilePaidIncomeOriginals({ client, soulId, purchaseText,
        withdrawalText: file.text, executionRegistry: registry, signal })
      if (current()) setView({ ...empty, file, result })
    } catch (error) {
      if (current()) setView({ ...empty, file, error: error instanceof Error ? error.message : '协议账本暂不可核对。' })
    } finally {
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
    }
  }

  const result = view.result
  return <section aria-label="原购买与原提款对账" className="space-y-2 rounded border p-3">
    <h2 className="font-semibold">核对付费入账与原提款</h2>
    <p>选择同一协议 Config 的原提款恢复文件。对账分别核验原购买、原提款和当前协议账本。</p>
    <label className="block">用于对账的原提款文件
      <input type="file" accept="application/json,.json" onChange={event => void select(event.currentTarget.files?.[0])}/>
    </label>
    {view.file && <>
      <p className="break-all">原提款 {view.file.digest} · {view.file.name}</p>
      <button type="button" className="rounded border px-3 py-1" disabled={view.pending} onClick={() => void query()}>核对两笔原交易</button>
    </>}
    {view.pending && <><p role="status">正在核对两笔原交易与协议账本…</p><button type="button" onClick={stop}>停止对账</button></>}
    {view.stopped && <p role="status">已停止对账。可用同一原件继续查询。</p>}
    {view.error && <p role="alert">对账未完成。{view.error}</p>}
    {result?.status === 'PAID_INCOME_LEDGER_RECONCILED'
      ? <article aria-label="已核验付费入账和提款" className="space-y-1 break-all">
        <p>原购买 {result.purchase.transactionDigest} · 检查点 {result.purchase.checkpoint}</p>
        <p>原买家总付款（最小单位）{result.purchase.money.buyerGrossDebit} · 内容受款方 {result.purchase.money.payout.amount} · 协议入账 {result.purchase.money.protocolIncome}</p>
        <p>原提款 {result.withdrawal.transactionDigest} · 检查点 {result.withdrawal.checkpoint}</p>
        <p>提款到账（最小单位）{result.withdrawal.amountAtomic} · 收款地址 {result.withdrawal.recipient}</p>
        <p>原收款 Coin {result.withdrawal.paymentCoinId} · 币种 {result.coinType}</p>
        {result.withdrawal.gas && <p>原提款 SUI Gas（MIST）{result.withdrawal.gas.netGasCharge}</p>}
        <p>当前 Config {result.current.configId} · 账本余额（最小单位）{result.current.balance} · 对象版本 {result.current.version}</p>
        <p>累计入账 {result.current.collected} · 累计提款 {result.current.withdrawn}</p>
        <p>{result.isolatedFeeCase ? '本次费用可与原提款逐笔对应。' : '本次提款按共用协议账本核对。'}</p>
        {result.purchaseToWithdrawal.kind === 'INTERVENING_CONFIG_WRITES' && <p>两笔之间另有入账 {result.purchaseToWithdrawal.collectedDelta} · 提款 {result.purchaseToWithdrawal.withdrawnDelta}</p>}
        {result.withdrawalToCurrent.kind === 'INTERVENING_CONFIG_WRITES' && <p>原提款之后另有入账 {result.withdrawalToCurrent.collectedDelta} · 提款 {result.withdrawalToCurrent.withdrawnDelta}</p>}
      </article>
      : result && <p role="status">{result.status === 'PURCHASE_WITHOUT_PROTOCOL_FEE' ? '原购买的协议费用为零。'
        : result.status === 'FINALIZED_EXECUTION' ? '已查到原提款终局执行，到账证据仍待来源或执行模型核验。'
        : result.status === 'FAILED' ? '链上已确认该原交易失败。'
        : result.status === 'PENDING' ? '该原交易仍待终局确认。'
        : '暂未查到该原交易。请保留原件继续核对。'}</p>}
    {result && 'stage' in result && <p className="break-all">{result.stage === 'PURCHASE' ? '原购买' : '原提款'} {result.transactionDigest}</p>}
  </section>
}
