'use client'

import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useRef } from 'react'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { createConfiguredIncomeOriginalExecutionRegistry } from '../../lib/soulidity/configured-income-entry'
import { importIncomeWithdrawalRecoveryRecord } from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import { confirmPaidIncomeOriginals, readCurrentPaidIncomeLedger, type ConfirmedPaidIncomeOriginals } from '../../lib/soulidity/commerce/paid-income-ledger-reconciliation'

import { PaidIncomePurchaseReadback } from './paid-income-purchase-readback'

type OriginalResult = Awaited<ReturnType<typeof confirmPaidIncomeOriginals>>
type Result = Exclude<OriginalResult, ConfirmedPaidIncomeOriginals> | Awaited<ReturnType<typeof readCurrentPaidIncomeLedger>>
const empty = {
  file: null as { name: string; text: string; digest: string } | null,
  pending: false, stopped: false, confirmed: null as ConfirmedPaidIncomeOriginals | null, result: null as Result | null, error: null as string | null,
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
    setView(previous => ({ ...empty, file: previous.file, confirmed: previous.confirmed, stopped: true }))
  }

  async function query() {
    const lease = session.capture(), file = view.file
    if (!file || !lease?.matches() || (active.current && !active.current.signal.aborted)) return
    const controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const current = () => lease.matches() && active.current === controller && !controller.signal.aborted
    let confirmed = view.confirmed
    setView({ ...empty, file, confirmed, pending: true })
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(75000)])
      if (!confirmed) {
        const { registry } = createConfiguredIncomeOriginalExecutionRegistry()
        const original = await confirmPaidIncomeOriginals({ client, soulId, purchaseText,
          withdrawalText: file.text, executionRegistry: registry, signal })
        if (!current()) return
        if (original.status !== 'PAID_INCOME_ORIGINALS_CONFIRMED') {
          setView({ ...empty, file, result: original })
          return
        }
        confirmed = original
        setView({ ...empty, file, confirmed, pending: true })
      }
      const result = await readCurrentPaidIncomeLedger({ client, confirmed, signal })
      if (current()) setView({ ...empty, file, confirmed, result })
    } catch (error) {
      if (current()) setView({ ...empty, file, confirmed,
        error: error instanceof Error ? error.message : '协议账本暂不可核对。' })
    } finally {
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
    }
  }

  const result = view.result, evidence = view.confirmed?.evidence
  return <section aria-label="原购买与原提款对账" className="space-y-2 rounded border p-3">
    <h2 className="font-semibold">核对付费入账与原提款</h2>
    <PaidIncomePurchaseReadback client={client} soulId={soulId} purchaseText={purchaseText}/>
    <p>已有提款回执时，可选择同一协议 Config 的原提款文件核对到账。</p>
    <label className="block">用于对账的原提款文件
      <input type="file" accept="application/json,.json" onChange={event => void select(event.currentTarget.files?.[0])}/>
    </label>
    {view.file && <>
      <p className="break-all">原提款 {view.file.digest} · {view.file.name}</p>
      <button type="button" className="rounded border px-3 py-1" disabled={view.pending} onClick={() => void query()}>
        {evidence ? '重新读取当前账本' : '核对两笔原交易'}
      </button>
    </>}
    {view.pending && <><p role="status">{evidence ? '正在读取当前协议账本…' : '正在核对两笔原交易…'}</p><button type="button" onClick={stop}>停止对账</button></>}
    {view.stopped && <p role="status">{evidence ? '已停止读取当前账本。可重新读取。' : '已停止对账。可用同一原件继续查询。'}</p>}
    {view.error && <p role="alert">对账未完成。{view.error}</p>}
    {evidence && <article aria-label="已核验原购买和原提款" className="space-y-1 break-all">
      <p>原购买 {evidence.purchase.transactionDigest} · 检查点 {evidence.purchase.checkpoint}</p>
      <p>原买家总付款（最小单位）{evidence.purchase.money.buyerGrossDebit} · 内容受款方 {evidence.purchase.money.payout.amount} · 协议入账 {evidence.purchase.money.protocolIncome}</p>
      <p>原提款 {evidence.withdrawal.transactionDigest} · 检查点 {evidence.withdrawal.checkpoint}</p>
      <p>提款到账（最小单位）{evidence.withdrawal.amountAtomic} · 收款地址 {evidence.withdrawal.recipient}</p>
      <p>原收款 Coin {evidence.withdrawal.paymentCoinId} · 币种 {evidence.coinType}</p>
      {evidence.withdrawal.gas && <p>原提款 SUI Gas（MIST）{evidence.withdrawal.gas.netGasCharge}</p>}
      <p>{evidence.isolatedFeeCase ? '本次费用可与原提款逐笔对应。' : '本次提款按共用协议账本核对。'}</p>
      {evidence.purchaseToWithdrawal.kind === 'INTERVENING_CONFIG_WRITES' && <p>两笔之间另有入账 {evidence.purchaseToWithdrawal.collectedDelta} · 提款 {evidence.purchaseToWithdrawal.withdrawnDelta}</p>}
    </article>}
    {result?.status === 'PAID_INCOME_LEDGER_RECONCILED'
      ? <article aria-label="已核验当前协议账本" className="space-y-1 break-all">
        <p>当前 Config {result.current.configId} · 账本余额（最小单位）{result.current.balance} · 对象版本 {result.current.version}</p>
        <p>累计入账 {result.current.collected} · 累计提款 {result.current.withdrawn}</p>
        {result.withdrawalToCurrent.kind === 'INTERVENING_CONFIG_WRITES' && <p>原提款之后另有入账 {result.withdrawalToCurrent.collectedDelta} · 提款 {result.withdrawalToCurrent.withdrawnDelta}</p>}
      </article>
      : result?.status === 'PAID_INCOME_CURRENT_UNVERIFIED'
        ? <p role="alert">{result.reason === 'CONFIG_REFERENCE_CONFLICT'
          ? '当前账本引用与原提款后的账本不连续，可重新读取。'
          : '当前协议账本暂不可读，可重新读取。'}</p>
      : result && <p role="status">{result.status === 'PURCHASE_WITHOUT_PROTOCOL_FEE' ? '原购买的协议费用为零。'
        : result.status === 'FINALIZED_EXECUTION' ? '已查到原提款终局执行，到账证据仍待来源或执行模型核验。'
        : result.status === 'FAILED' ? '链上已确认该原交易失败。'
        : result.status === 'PENDING' ? '该原交易仍待终局确认。'
        : '暂未查到该原交易。请保留原件继续核对。'}</p>}
    {result && 'stage' in result && <p className="break-all">{result.stage === 'PURCHASE' ? '原购买' : '原提款'} {result.transactionDigest}</p>}
  </section>
}
