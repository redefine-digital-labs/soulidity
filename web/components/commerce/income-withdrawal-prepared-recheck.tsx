'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useCommittedSession } from '../../lib/hooks/use-committed-session'
import { publicMutationCanonical } from '../../lib/sui/public-mutation-journal'
import { importIncomeWithdrawalRecoveryRecord } from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import { validateIncomeWithdrawalResumeResult, type IncomeWithdrawalResumeCapability } from '../../lib/soulidity/commerce/income-withdrawal-host-resume'
import type { IncomeWithdrawalJournalRecordV1 } from '../../lib/soulidity/income-withdrawal-journal-v1'

export function IncomeWithdrawalPreparedRecheck({ selected, viewerAddress, capability, disabledReason = null }: {
  selected: IncomeWithdrawalJournalRecordV1; viewerAddress: string | null
  capability: IncomeWithdrawalResumeCapability | null; disabledReason?: string | null
}) {
  const identity = publicMutationCanonical(selected)
  const activeCapability = () => { try { return capability?.isActive() === true } catch { return false } }
  const active = activeCapability()
  const scope = JSON.stringify([identity, capability?.activationKey, capability?.sourceId, active, disabledReason])
  const authority = useMemo(() => ({ capability, host: capability?.host, isActive: capability?.isActive }),
    [capability, capability?.host, capability?.isActive])
  const session = useCommittedSession(scope, viewerAddress, capability?.client, authority)
  const generation = session.generation, serial = useRef(0), attempt = useRef<number | null>(null), pending = useRef<AbortController | null>(null)
  const same = session.matches
  const empty = () => ({ generation, pending: false, attempted: false, checked: false, stopped: false, error: null as string | null })
  const [state, setState] = useState(empty), view = state.generation === generation ? state : empty()
  useEffect(() => {
    const id = ++serial.current; pending.current?.abort()
    setState(previous => same() && serial.current === id ? empty() : previous)
    return () => { serial.current++; pending.current?.abort() }
  }, [generation])
  let original: ReturnType<typeof importIncomeWithdrawalRecoveryRecord> | null = null
  try { original = importIncomeWithdrawalRecoveryRecord(selected.plan.originalText) } catch { /* malformed snapshots never enable Host */ }
  const unavailable = disabledReason || (!original ? '原件格式无法核验，请保留原文件。' : selected.packet.phase !== 'PREPARED' || selected.packet.signature !== null
    ? '请只查询原结果；当前记录不是可再核对的未签名原头。' : !capability || typeof capability.host !== 'function' || typeof capability.client !== 'function' || !capability.activationKey || !capability.sourceId || !activeCapability() ? '当前来源与主机未取得恢复核对资格。'
      : viewerAddress !== original.intent.actor ? '请连接原提款的管理钱包。' : null)
  async function recheck() {
    if (!same() || unavailable || !capability || view.pending || view.attempted || attempt.current === generation) return
    const cap = capability, host = cap.host, client = cap.client, activationKey = cap.activationKey, sourceId = cap.sourceId, isActive = cap.isActive,
      saved = structuredClone(selected), id = ++serial.current, controller = new AbortController()
    attempt.current = generation; pending.current?.abort(); pending.current = controller
    const valid = () => { try { return same() && serial.current === id && !controller.signal.aborted && isActive.call(cap) === true } catch { return false } }
    const publish = (next: ReturnType<typeof empty>) => setState(previous => valid() ? next : previous)
    publish({ ...empty(), pending: true, attempted: true })
    try {
      const result = await host.call(cap, { selected: saved, client: client.call(cap, controller.signal), signal: controller.signal,
        getActorAddress: () => valid() ? viewerAddress : null, isCurrent: valid, activationKey, sourceId })
      if (!valid()) return
      await validateIncomeWithdrawalResumeResult(saved, result)
      publish({ ...empty(), attempted: true, checked: true })
    } catch (error) { publish({ ...empty(), attempted: true, error: error instanceof Error ? error.message : 'ORIGINAL_RESUME_FAILED' }) }
  }
  function stop() {
    if (!same()) return
    const id = ++serial.current; pending.current?.abort()
    setState(previous => same() && serial.current === id ? { ...empty(), attempted: true, stopped: true } : previous)
  }
  return <section aria-label="继续原提款预检" className="space-y-3 rounded-xl border p-4">
    <h3>继续原提款预检</h3>
    <p className="break-all">{selected.packet.digest}</p>
    <p>沿用原交易字节、Gas 和有效期；不创建新意图，不签名、发送或修改保存阶段。</p>
    {unavailable && <p role="status">{unavailable}</p>}
    <button type="button" disabled={Boolean(unavailable) || view.pending || view.attempted} onClick={() => void recheck()}>重新核对原提款</button>
    {view.pending && <><p role="status">正在核对原结果、当前权限与原字节模拟…</p><button type="button" onClick={stop}>停止原提款核对</button></>}
    {view.stopped && <p role="status">已停止等待。已开始的核对会保留操作锁直到结束；原件仍可查询和下载。</p>}
    {view.error && <p role="alert">{view.error}。请保留原件；这不授权再次提款。</p>}
    {view.checked && <p role="status">原字节模拟核对完成。未签名或发送，不代表到账，也不授予新的提款权限。</p>}
  </section>
}
