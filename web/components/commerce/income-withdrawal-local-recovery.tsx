'use client'
import React, { useEffect, useRef, useState } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { publicMutationCanonical } from '../../lib/sui/public-mutation-journal'
import { incomeWithdrawalFundKeyV1, browserIncomeWithdrawalOriginalReaderV1, type IncomeWithdrawalJournalRecordV1 } from '../../lib/soulidity/income-withdrawal-journal-v1'
import { discoverIncomeWithdrawalOriginalsV1, cancelIncomeWithdrawalOriginalV1 } from '../../lib/soulidity/income-withdrawal-original-recovery'
import { createIncomeWithdrawalOriginalClient } from '../../lib/soulidity/income-withdrawal-original-client'
import { importIncomeWithdrawalRecoveryRecord, incomeWithdrawalRecoveryProps } from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import { IncomeWithdrawalRecovery } from './income-withdrawal-recovery'
import { IncomeWithdrawalExecute } from './income-withdrawal-execute'
import { IncomeWithdrawalPreparedRecheck } from './income-withdrawal-prepared-recheck'
import { useIncomeWithdrawalResumeCapability } from '../providers/income-withdrawal-resume-provider'
type Client = (signal: AbortSignal) => SuiGrpcClient
type View = { client: Client; records: IncomeWithdrawalJournalRecordV1[]; selected: string | null; archives: IncomeWithdrawalJournalRecordV1[]; archiveSelection: string | null;
  historyError: string | null; pending: boolean; stopped: boolean; error: string | null }
const archiveKey = (record: IncomeWithdrawalJournalRecordV1) => `${record.packet.digest}:${record.packet.phase}`

/** Root's same unique funds domain, read/export/query without fresh config or
 * wallet. The old file importer remains a separate independent recovery path.
 */
export function IncomeWithdrawalLocalRecovery({ viewerAddress = null, createReadOnlyClient = createIncomeWithdrawalOriginalClient }: {
  viewerAddress?: string | null; createReadOnlyClient?: Client
}) {
  const resume = useIncomeWithdrawalResumeCapability()
  const current = useRef(createReadOnlyClient); current.current = createReadOnlyClient
  const serial = useRef(0), busy = useRef(false), active = useRef<AbortController | null>(null)
  const empty = (): View => ({ client: createReadOnlyClient, records: [], selected: null, archives: [], archiveSelection: null, historyError: null, pending: false, stopped: false, error: null })
  const [state, setState] = useState<View>(empty), [locks, setLocks] = useState(false)
  const view = state.client === createReadOnlyClient ? state : empty()
  const head = view.records.find(row => incomeWithdrawalFundKeyV1(row.plan) === view.selected) ?? null
  const record = view.archiveSelection ? view.archives.find(row => archiveKey(row) === view.archiveSelection) ?? null : head
  const same = () => current.current === createReadOnlyClient
  function publish(id: number, update: (previous: View) => View, signal?: AbortSignal, selected?: IncomeWithdrawalJournalRecordV1) {
    setState(previous => {
      if (!same() || serial.current !== id || signal?.aborted) return previous
      const base = previous.client === createReadOnlyClient ? previous : empty()
      if (selected) {
        const visible = base.records.find(row => incomeWithdrawalFundKeyV1(row.plan) === base.selected)
        if (!visible || publicMutationCanonical(visible) !== publicMutationCanonical(selected)) return previous
      }
      return update(base)
    })
  }
  useEffect(() => {
    setLocks(typeof navigator !== 'undefined' && Boolean(navigator.locks?.request)); void discover()
    return () => { serial.current++; busy.current = false; active.current?.abort() }
  }, [createReadOnlyClient])
  async function discover() {
    if (!same()) return
    const id = ++serial.current; active.current?.abort(); busy.current = true
    publish(id, previous => ({ ...previous, pending: true, stopped: false, error: null }))
    try {
      const records = await discoverIncomeWithdrawalOriginalsV1()
      publish(id, previous => ({ ...empty(), records, selected: records.some(row => incomeWithdrawalFundKeyV1(row.plan) === previous.selected)
        ? previous.selected : records[0] ? incomeWithdrawalFundKeyV1(records[0].plan) : null }))
    } catch (error) {
      publish(id, previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : '本机原提款记录无法核对。' }))
    } finally { if (same() && serial.current === id) busy.current = false }
  }
  function select(key: string) {
    if (!same()) return
    const id = ++serial.current; active.current?.abort(); busy.current = false
    publish(id, previous => ({ ...previous, selected: key, archives: [], archiveSelection: null, historyError: null, pending: false, stopped: false }))
  }
  async function history() {
    if (!same() || !head || busy.current) return
    const id = ++serial.current, selected = incomeWithdrawalFundKeyV1(head.plan); active.current?.abort(); busy.current = true
    publish(id, previous => ({ ...previous, pending: true, historyError: null }))
    try {
      const archives = await browserIncomeWithdrawalOriginalReaderV1().history(selected)
      publish(id, previous => previous.selected === selected ? { ...previous, pending: false, archives } : previous)
    } catch (error) { publish(id, previous => ({ ...previous, pending: false, historyError: error instanceof Error ? error.message : '历史原件未能核对。' })) }
    finally { if (same() && serial.current === id) busy.current = false }
  }
  function chooseArchive(key: string) {
    if (!same()) return
    const id = ++serial.current; active.current?.abort(); busy.current = false
    publish(id, previous => ({ ...previous, archiveSelection: previous.archives.some(row => archiveKey(row) === key) ? key : null, pending: false, stopped: false }))
  }
  async function cancel() {
    if (!same() || !record || view.archiveSelection || busy.current || view.error || view.stopped || !locks || record.packet.phase !== 'PREPARED' || record.packet.signature !== null) return
    const selected = structuredClone(record), id = ++serial.current, controller = new AbortController()
    active.current?.abort(); active.current = controller; busy.current = true
    publish(id, previous => ({ ...previous, pending: true, error: null, stopped: false }), controller.signal, selected)
    try {
      const result = await cancelIncomeWithdrawalOriginalV1({ record: selected, client: createReadOnlyClient(controller.signal), signal: controller.signal })
      publish(id, previous => ({ ...previous, pending: false, records: previous.records.map(row => incomeWithdrawalFundKeyV1(row.plan) === incomeWithdrawalFundKeyV1(result.record.plan) ? result.record : row) }), controller.signal, selected)
    } catch (error) { publish(id, previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : '原提款取消核对未完成。' }), controller.signal, selected) }
    finally { if (same() && serial.current === id) busy.current = false }
  }
  function stop() {
    if (!same()) return
    const id = ++serial.current; active.current?.abort(); busy.current = false
    publish(id, previous => ({ ...previous, pending: false, stopped: true }))
  }
  const original = record ? importIncomeWithdrawalRecoveryRecord(record.plan.originalText) : null
  const retirement = resume.capability?.retirement
  const canRetire = Boolean(record && original && !view.archiveSelection && locks
    && ['SIGNING', 'SIGNED'].includes(record.packet.phase) && retirement?.canRetire(original.target))

  async function retire() {
    if (!same() || !record || !retirement || !canRetire || busy.current || view.error || view.stopped) return
    const selected = structuredClone(record), id = ++serial.current, controller = new AbortController()
    active.current?.abort(); active.current = controller; busy.current = true
    const valid = () => same() && serial.current === id && !controller.signal.aborted
    publish(id, previous => ({ ...previous, pending: true, error: null, stopped: false }), controller.signal, selected)
    try {
      const { record: updated, original: observed } = await retirement.retire({ selected, signal: controller.signal, isCurrent: valid })
      const expectedPacket = { ...selected.packet, phase: 'RETIRED' }
      if (!updated.retirement || observed.status !== 'MISSING' || publicMutationCanonical(updated.plan) !== publicMutationCanonical(selected.plan)
        || publicMutationCanonical(updated.packet) !== publicMutationCanonical(expectedPacket)) throw Error('退役结果与所选原提款不一致。')
      publish(id, previous => ({ ...previous, pending: false, records: previous.records.map(row =>
        incomeWithdrawalFundKeyV1(row.plan) === incomeWithdrawalFundKeyV1(updated.plan) ? updated : row) }), controller.signal, selected)
    } catch (error) {
      publish(id, previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : '原提款退役核对未完成。' }), controller.signal, selected)
    } finally { if (same() && serial.current === id) busy.current = false }
  }

  return <section aria-label="本机原提款记录" className="space-y-4 rounded-xl border p-4">
    <h2>本机原提款记录</h2>
    <p>无需新提款配置、连接钱包或导入文件。这里保留同一协议资金范围的原操作，切换操作人或收款人不会绕过旧未知结果。</p>
    <button type="button" disabled={view.pending} onClick={() => void discover()}>重新发现本机原提款</button>
    {view.error && <p role="alert">{view.error}。保留原件；以下已有记录仅是先前核验的快照，不能据此新提款或取消。</p>}
    {!view.pending && !view.error && !view.records.length && <p>本机未发现已核验的原提款记录。可使用下方原文件导入；这不表示以前没有提款。</p>}
    {view.records.length > 0 && <label>所选原提款<select value={view.selected ?? ''} onChange={event => select(event.currentTarget.value)}>{view.records.map(row => <option key={incomeWithdrawalFundKeyV1(row.plan)} value={incomeWithdrawalFundKeyV1(row.plan)}>{row.plan.configId} · {row.plan.coinType} · {row.packet.digest}</option>)}</select></label>}
    {head && <div className="space-y-2"><button type="button" disabled={view.pending} onClick={() => void history()}>读取此资金范围的历史原件</button>
      {view.historyError && <p role="alert">历史原件查询未完成：{view.historyError}。当前原件仍可下载；不会删除或跳过已有历史。</p>}
      {view.archives.length > 0 && <label>历史原件<select aria-label="原提款历史选择" value={view.archiveSelection ?? ''} onChange={event => chooseArchive(event.currentTarget.value)}><option value="">当前原件</option>{view.archives.map(row => <option key={archiveKey(row)} value={archiveKey(row)}>{row.packet.digest} · {row.packet.phase}</option>)}</select></label>}
    </div>}
    {record && original && <article aria-label="已核验本机原提款" className="space-y-3 break-all">
      <p>原操作人：{original.intent.actor} · 原收款人：{original.intent.recipient}</p>
      <p>本机保存阶段：{record.packet.phase}；此元数据不证明签名有效或链上成功。</p>
      {view.archiveSelection && <p>当前显示历史原件；需按其原交易查询，不能把历史阶段当作当前余额或新提款权限。</p>}
      <button type="button" disabled={Boolean(view.archiveSelection) || view.pending || Boolean(view.error) || view.stopped || !locks || record.packet.phase !== 'PREPARED' || record.packet.signature !== null} onClick={() => void cancel()}>核对并取消本机未签名提款</button>
      <p>只在完整未签原记录与原交易 MISSING 时保存本机 CANCELLED，不撤销链上交易、不生成新提款授权。原文件保持不变。</p>
      {!locks && <p>当前环境没有操作锁；仍可查看、下载和查询原记录，不能修改本机阶段。</p>}
      {canRetire && <button type="button" disabled={view.pending || Boolean(view.error) || view.stopped} onClick={() => void retire()}>
        核对并退役过期原提款
      </button>}
      {record.retirement && <article aria-label="已核验过期原提款退役" className="space-y-1">
        <p>已保存退役证据 · 检查点 {record.retirement.checkpoint.sequenceNumber} · Epoch {record.retirement.checkpoint.epoch}</p>
        <p>Config 对象版本 {record.retirement.config.version} · 核对回执 {record.retirement.tableSize} 项</p>
        <p>准备下一笔提款时，将重新核验原摘要与回执表，再归档本原件。</p>
      </article>}
      <IncomeWithdrawalRecovery key={`${record.packet.digest}:${record.packet.phase}`} {...incomeWithdrawalRecoveryProps(original)} client={createReadOnlyClient} viewerAddress={viewerAddress}/>
      {!view.archiveSelection && resume.capability?.execute &&
        <IncomeWithdrawalExecute key={record.packet.digest} originalText={record.plan.originalText} phase={record.packet.phase}
          viewerAddress={viewerAddress} capability={resume.capability}
          disabled={Boolean(view.error || view.stopped || view.pending || !locks)}
          onRecord={updated => setState(previous => ({
            ...previous, records: previous.records.map(row => publicMutationCanonical(row) === publicMutationCanonical(record) ? updated : row),
          }))}/>}
      {!view.archiveSelection && <IncomeWithdrawalPreparedRecheck selected={record} viewerAddress={viewerAddress} capability={resume.capability}
        disabledReason={view.error || view.stopped || view.pending ? '请先重新核验当前本机原记录。原查询与下载仍可使用。' : resume.disabledReason}/>}
    </article>}
    {view.pending && <><p role="status">正在核对本机原提款…</p><button type="button" onClick={stop}>停止本机提款操作</button></>}
    {view.stopped && <p role="status">已停止本页等待。已开始的写入会保留资金与原件锁直到读回结束；请重新发现原记录，不能据此重新提款。</p>}
  </section>
}
