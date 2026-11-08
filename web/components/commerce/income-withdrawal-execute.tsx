'use client'

import React, { useRef } from 'react'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { useWalletSign } from '../../lib/hooks/use-wallet-sign'
import { importIncomeWithdrawalRecoveryRecord } from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import type { IncomeWithdrawalExecutionHost, IncomeWithdrawalResumeCapability } from '../../lib/soulidity/commerce/income-withdrawal-host-resume'
import { browserIncomeWithdrawalOriginalReaderV1, incomeWithdrawalFundKeyV1, type IncomeWithdrawalJournalRecordV1 } from '../../lib/soulidity/income-withdrawal-journal-v1'

type Result = Awaited<ReturnType<IncomeWithdrawalExecutionHost>>
const empty = { pending: false, attempted: false, result: null as Result | null, error: null as string | null }

export function IncomeWithdrawalExecute({ originalText, viewerAddress, capability, phase = 'PREPARED',
  isActivationCurrent, disabled = false, onRecord }: {
  originalText: string; viewerAddress: string | null; capability: IncomeWithdrawalResumeCapability
  phase?: IncomeWithdrawalJournalRecordV1['packet']['phase']; isActivationCurrent?: () => boolean
  disabled?: boolean; onRecord?: (record: IncomeWithdrawalJournalRecordV1) => void
}) {
  const wallet = useWalletSign()
  const { getWalletAddress, signTransaction } = wallet
  const original = importIncomeWithdrawalRecoveryRecord(originalText)
  const { actor, recipient, amount } = original.intent
  const execute = capability.execute
  const session = useCommittedSession(JSON.stringify([originalText, viewerAddress, capability.activationKey, capability.sourceId]),
    wallet.walletAccount ?? wallet.suiWallet?.address, capability, wallet.currentWallet)
  const [view, setView] = useSessionState(session, empty)
  const active = useRef<AbortController | null>(null)
  const executablePhase = ['PREPARED', 'SIGNING', 'SIGNED'].includes(phase)
  const sourceCurrent = () => capability.isActive() && (isActivationCurrent?.() ?? true)
  const available = !disabled && executablePhase && execute && viewerAddress === actor
    && wallet.suiWallet?.address === actor && sourceCurrent()

  async function send() {
    const lease = session.capture()
    if (!available || !execute || !lease?.matches() || lease.isRunning() || view.attempted || getWalletAddress() !== actor) return
    const controller = new AbortController()
    lease.setRunning(true)
    lease.requests.add(controller)
    active.current = controller
    const matches = () => lease.matches() && active.current === controller && !controller.signal.aborted
    const current = () => matches() && sourceCurrent() && getWalletAddress() === actor
    setView({ ...empty, pending: true, attempted: true })
    try {
      const record = await browserIncomeWithdrawalOriginalReaderV1().read(incomeWithdrawalFundKeyV1(original.target))
      if (!current()) throw Error('提款会话或来源已变更。')
      if (!record || record.plan.originalText !== originalText || record.packet.phase !== phase) throw Error('本机原提款已变化，请重新发现原记录。')
      const result = await execute({
        selected: record, client: capability.client(controller.signal), signal: controller.signal,
        sourceId: capability.sourceId, activationKey: capability.activationKey, isCurrent: current,
        getActorAddress: () => current() ? getWalletAddress() : null,
        sign: transaction => {
          if (!current()) throw Error('提款钱包已变更。')
          return signTransaction(transaction, { retainReturnedSignature: true })
        },
      })
      if (result.record.plan.originalText !== originalText || result.record.packet.digest !== record.packet.digest) throw Error('返回的原交易与所选提款不一致。')
      if (matches()) {
        setView({ ...empty, attempted: true, result })
        onRecord?.(result.record)
      }
    } catch (error) {
      if (matches()) setView({ ...empty, attempted: true, error: error instanceof Error ? error.message : '原提款发送或核对未完成。' })
    } finally {
      lease.requests.delete(controller)
      lease.setRunning(false)
      if (active.current === controller) active.current = null
    }
  }

  const result = view.result?.original
  if (!executablePhase && !result) return null
  const outcome = result?.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? result : null
  return <section aria-label="发送已保存的原提款" className="space-y-2 break-all">
    <p>原交易 {original.packet.digest} · 金额 {amount} · 收款地址 {recipient}</p>
    <button type="button" disabled={!available || view.pending || view.attempted} onClick={() => void send()}>
      {phase === 'SIGNED' ? '核对并重送同一原提款' : '核对并签名发送原提款'}
    </button>
    {view.pending && <><p role="status">正在核对并继续原提款…</p><button type="button" onClick={() => {
      active.current?.abort()
      active.current = null
      setView({ ...empty, attempted: true, error: '已停止等待。请按原摘要查询已开始的操作。' })
    }}>停止等待原提款</button></>}
    {view.error && <p role="alert">{view.error} 请保留原件并核对原交易。</p>}
    {outcome && <article aria-label="已核验原提款到账">
      <p>原提款已到账 · 检查点 {outcome.checkpoint} · 原收款 Coin {outcome.receipt.paymentCoinId}</p>
      <p>到账 {outcome.receipt.receipt.amount} · 币种 {outcome.receipt.coinType} · 收款人 {outcome.receipt.receipt.recipient}</p>
    </article>}
    {result && !outcome && <p role="status">{result.status === 'FAILED' ? '链上已确认原提款失败。'
      : result.status === 'FINALIZED_EXECUTION' ? '原执行已终局，到账证据仍待核验。'
      : result.status === 'PENDING' ? '已找到原交易，等待检查点确认。'
      : '本次未查到原交易，请按同一摘要继续查询。'}</p>}
    <a href="/income/recovery">打开原提款查询与资金核对</a>
  </section>
}
