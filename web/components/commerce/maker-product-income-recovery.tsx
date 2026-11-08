'use client'
import React, { useEffect, useRef, useState } from 'react'
import { profileReadStep } from '@soulidity/sdk'
import { IncomeOriginalExecutionObservation } from './income-original-execution-observation'
import { IncomeWithdrawalAddressFunds } from './income-withdrawal-address-funds'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { readMakerProductIncome, type MakerProductIncomeTarget } from '../../lib/soulidity/commerce/maker-product-income-read'
import { publicMutationCanonical } from '../../lib/sui/public-mutation-journal'
import { commerceCheck } from '../../lib/soulidity/commerce/economics-read'
import type { RootMakerProductIncomeController } from '../../lib/soulidity/commerce/maker-product-income-controller'
import { importMakerProductIncomeRecoveryRecord, queryMakerProductIncomeRecoveryRecord } from '../../lib/soulidity/commerce/maker-product-income-recovery-record'
import type { MakerProductIncomeWalletSigner } from '../../lib/soulidity/maker-product-income-execution'
import { assertMakerProductIncomeSimulationInputs } from '../../lib/soulidity/commerce/maker-product-income-simulation'
import { browserMakerProductIncomeOriginalReader, makerProductIncomeFundKey, type MakerProductIncomeOperation } from '../../lib/soulidity/maker-product-income-journal'

type OriginalQuery = Awaited<ReturnType<typeof queryMakerProductIncomeRecoveryRecord>>
type ConfirmedWithdrawal = Extract<OriginalQuery, { status: 'WITHDRAWAL_EVIDENCE_CONFIRMED' }>

/** Readonly discovery/import/query/export remain independent from installation
 * and wallet. Mutations/continuation use the sole Root Product Host key.
 */
export function MakerProductIncomeRecoveryWorkbench({ controller, viewerAddress, wallet = null }: { controller: RootMakerProductIncomeController; viewerAddress: string | null; wallet?: MakerProductIncomeWalletSigner | null }) {
  const [heads, setHeads] = useState<MakerProductIncomeOperation[]>([]), [history, setHistory] = useState<{ fundKey: string; controller: RootMakerProductIncomeController; records: MakerProductIncomeOperation[] } | null>(null)
  const [selected, setSelected] = useState<MakerProductIncomeOperation | null>(null), [imported, setImported] = useState<string | null>(null), [draft, setDraft] = useState('')
  const [selectionEpoch, setSelectionEpoch] = useState(0)
  const rootCurrent = controller.isCurrent()
  const [locks, setLocks] = useState(false), [loadError, setLoadError] = useState<string | null>(null)
  const text = imported ?? selected?.plan.originalText ?? null
  const scope = publicMutationCanonical([selected, imported, viewerAddress, controller.catalogVersion, rootCurrent, selectionEpoch])
  const frame = useRef({ scope, controller, viewerAddress, wallet, generation: 0 })
  if (frame.current.scope !== scope || frame.current.controller !== controller || frame.current.wallet !== wallet) frame.current = { scope, controller, viewerAddress, wallet, generation: frame.current.generation + 1 }
  const generation = frame.current.generation, serial = useRef(0), loading = useRef(0), active = useRef<AbortController | null>(null), busy = useRef(false), mutationAttempt = useRef<number | null>(null)
  const fileFrame = useRef({ controller, viewerAddress, rootCurrent, catalogVersion: controller.catalogVersion, generation: 0 })
  const fileInput = useRef<HTMLInputElement | null>(null)
  if (fileFrame.current.controller !== controller || fileFrame.current.viewerAddress !== viewerAddress || fileFrame.current.rootCurrent !== rootCurrent || fileFrame.current.catalogVersion !== controller.catalogVersion) {
    loading.current++
    fileFrame.current = { controller, viewerAddress, rootCurrent, catalogVersion: controller.catalogVersion, generation: fileFrame.current.generation + 1 }
  }
  const same = () => frame.current.generation === generation && frame.current.controller === controller
  const empty = () => ({ generation, pending: false, message: null as string | null, error: null as string | null, execution: null as Extract<OriginalQuery, { status: 'FINALIZED_EXECUTION' }> | null, withdrawal: null as ConfirmedWithdrawal | null })
  const [state, setState] = useState(empty), view = state.generation === generation ? state : empty()
  useEffect(() => {
    const input = fileInput.current, cancel = () => chooseFile(undefined)
    input?.addEventListener('cancel', cancel)
    return () => input?.removeEventListener('cancel', cancel)
  }, [controller, generation])
  useEffect(() => { const id = ++serial.current; active.current?.abort(); busy.current = false; mutationAttempt.current = null; setState(previous => same() && serial.current === id ? empty() : previous); return () => { serial.current++; active.current?.abort() } }, [generation])
  useEffect(() => { setLocks(typeof navigator !== 'undefined' && Boolean(navigator.locks?.request)); void discover(); return () => { loading.current++ } }, [controller])
  async function discover() {
    const id = ++loading.current; const valid = () => loading.current === id && frame.current.controller === controller
    setSelectionEpoch(value => valid() ? value + 1 : value)
    try {
      const records = await browserMakerProductIncomeOriginalReader().heads()
      if (!valid()) return
      setHeads(previous => valid() ? records : previous); setHistory(previous => valid() ? null : previous); setSelected(previous => valid() ? records[0] ?? null : previous); setImported(previous => valid() ? null : previous); setLoadError(previous => valid() ? null : previous)
    } catch (error) { setLoadError(previous => valid() ? error instanceof Error ? error.message : '本机 Product 原件尚不可读。' : previous) }
  }
  function select(record: MakerProductIncomeOperation) {
    if (frame.current.controller !== controller) return
    const id = ++loading.current, chosen = structuredClone(record), valid = () => loading.current === id && frame.current.controller === controller
    serial.current++; active.current?.abort(); busy.current = false
    setHistory(previous => valid() ? null : previous); setSelectionEpoch(value => valid() ? value + 1 : value); setSelected(previous => valid() ? chosen : previous); setImported(previous => valid() ? null : previous)
  }
  function importText(value: string) {
    if (frame.current.controller !== controller) return
    const id = ++loading.current, valid = () => loading.current === id && frame.current.controller === controller
    serial.current++; active.current?.abort(); busy.current = false
    setHistory(previous => valid() ? null : previous); setSelectionEpoch(previous => valid() ? previous + 1 : previous)
    try { importMakerProductIncomeRecoveryRecord(value); setImported(previous => valid() ? value : previous); setSelected(previous => valid() ? null : previous); setLoadError(previous => valid() ? null : previous) }
    catch (error) { setLoadError(previous => valid() ? error instanceof Error ? error.message : '原文件无法核对。' : previous) }
  }
  function chooseFile(file: File | undefined) {
    if (frame.current.controller !== controller) return
    const id = ++loading.current, fileGeneration = fileFrame.current.generation
    const valid = () => loading.current === id && fileFrame.current.generation === fileGeneration && frame.current.controller === controller
    // Choosing a file is a new selection even when its size/text is invalid.
    // Invalidate running/queued actions before the first file operation.
    serial.current++; active.current?.abort(); busy.current = false; mutationAttempt.current = null
    setHistory(previous => valid() ? null : previous); setSelected(previous => valid() ? null : previous); setImported(previous => valid() ? null : previous)
    setSelectionEpoch(previous => valid() ? previous + 1 : previous); setLoadError(previous => valid() ? null : previous)
    setState(previous => valid() ? empty() : previous)
    if (!file) return
    if (file.size > 300000) { setLoadError(previous => valid() ? '原文件超过大小上限。' : previous); return }
    void (async () => {
      try { const value = await file.text(); if (valid()) importText(value) }
      catch (error) { setLoadError(previous => valid() ? error instanceof Error ? error.message : '文件无法读取。' : previous) }
    })()
  }
  let original: ReturnType<typeof importMakerProductIncomeRecoveryRecord> | null = null
  try { if (text) original = importMakerProductIncomeRecoveryRecord(text) } catch { /* Unverified raw text never supplies export or operations. */ }
  const resumeAvailable = Boolean(selected && !imported && selected.packet.phase === 'PREPARED' && selected.packet.signature === null && original && viewerAddress === original.intent.actor && locks && controller.canResumeTarget(original.target))
  const cancelAvailable = Boolean(selected && !imported && selected.packet.phase === 'PREPARED' && selected.packet.signature === null && locks)
  const executeAvailable = Boolean(wallet && selected && !imported && original && viewerAddress === original.intent.actor && locks
    && ['PREPARED', 'SIGNING', 'SIGNED'].includes(selected.packet.phase) && controller.canExecuteTarget?.(original.target))
  const retireAvailable = Boolean(selected && !imported && original && locks
    && ['SIGNING','SIGNED'].includes(selected.packet.phase) && controller.canRetireTarget?.(original.target))
  async function action(kind: 'query' | 'resume' | 'cancel' | 'execute' | 'retire') {
    if (!same() || busy.current || !original || !text) return
    if (kind === 'resume' && !resumeAvailable || kind === 'cancel' && !cancelAvailable || kind === 'execute' && !executeAvailable || kind === 'retire' && !retireAvailable) return
    if (kind !== 'query' && mutationAttempt.current === generation) return
    if (kind !== 'query') mutationAttempt.current = generation
    busy.current = true
    const id = ++serial.current, abort = new AbortController(); active.current?.abort(); active.current = abort
    const valid = () => same() && serial.current === id && !abort.signal.aborted && ((kind !== 'resume' && kind !== 'execute' && kind !== 'retire') || controller.isCurrent())
    const publish = (value: ReturnType<typeof empty>) => setState(previous => valid() ? {
      ...value, withdrawal: value.withdrawal ?? ((kind === 'query' || kind === 'execute') && previous.generation === generation ? previous.withdrawal : null),
    } : previous)
    publish({ ...empty(), pending: true })
    try {
      let message: string, execution: ReturnType<typeof empty>['execution'] = null
      let withdrawal: ConfirmedWithdrawal | null = null
      if (kind === 'query' || kind === 'execute') {
        let result: OriginalQuery
        let signedOriginal = false
        if (kind === 'query') result = await controller.queryOriginal(text, abort.signal)
        else {
          const executed = await controller.executeOriginal({ selected: structuredClone(selected!), signal: abort.signal,
            wallet: { getActorAddress: () => valid() ? wallet!.getActorAddress() : null, sign: wallet!.sign },
            isCurrent: () => valid() })
          commerceCheck(executed.record.plan.originalText === text && executed.record.packet.digest === original.packet.digest, 'MAKER_INCOME_EXECUTION_SELECTED_ORIGINAL')
          result = executed.original
          signedOriginal = executed.record.packet.phase === 'SIGNED'
        }
        if (result.status === 'FINALIZED_EXECUTION') execution = result
        if (result.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED') {
          const { receipt } = result
          commerceCheck(receipt.transactionDigest === original.packet.digest && receipt.receipt.root === original.target.productId
            && receipt.inputControl.objectId === original.intent.controlId && receipt.receipt.actor === original.intent.actor
            && receipt.receipt.recipient === original.intent.recipient && receipt.receipt.amount === original.intent.amount
            && receipt.coinType === original.target.coinType, 'MAKER_INCOME_RECOVERY_RECEIPT_SCOPE')
          withdrawal = result
        }
        message = result.status === 'FINALIZED_EXECUTION'
          ? '原交易已终局执行成功，但来源或执行模型尚未获资格，提款到账证据尚未确认。原文件与待核验记录保留，不能据此重新提款。'
          : kind === 'execute' && (result.status === 'MISSING' || result.status === 'PENDING')
            ? signedOriginal ? '原交易结果待确认，继续查询原摘要。已签名原件仍保存在本机。' : '原交易结果待确认，继续查询原摘要。'
            : `原交易核对状态：${result.status}。此查询不授予新提款或签名权限。`
      } else if (kind === 'retire') {
        const result = await controller.retireOriginal({ selected: structuredClone(selected!), signal: abort.signal, isCurrent: valid })
        commerceCheck(result.record.plan.originalText === text && result.record.packet.digest === original.packet.digest
          && result.record.packet.phase === 'RETIRED' && result.record.retirement && result.original.status === 'MISSING', 'MAKER_INCOME_RETIREMENT_RETURN')
        message = `已在检查点 ${result.record.retirement.checkpoint.sequenceNumber} 核对过期及收据表，原提款已归档。请刷新本机记录。`
      } else if (kind === 'cancel') {
        const result = await controller.cancelUnsigned(structuredClone(selected!), abort.signal)
        commerceCheck(result.record.plan.originalText === text && result.record.packet.phase === 'CANCELLED' && result.record.packet.signature === null && result.notOnChainCancellation, 'MAKER_INCOME_CANCEL_RETURN')
        message = '本机未签名准备已记为 CANCELLED，原文件保留。这不撤销链上交易；请刷新本机记录后重新观察。'
      } else {
        const result = await controller.resume({ selected: structuredClone(selected!), signal: abort.signal, getActorAddress: () => valid() ? frame.current.viewerAddress : null, isCurrent: () => valid() })
        commerceCheck(publicMutationCanonical(result.selected) === publicMutationCanonical(selected) && result.originalText === text && result.recheck.originalBytesUnchanged && result.recheck.notSigningQualification
          && publicMutationCanonical(result.recheck.record) === publicMutationCanonical(original) && result.recheck.simulation.transactionDigest === original.packet.digest && result.recheck.simulation.checksRequested === 'ENABLED' && result.recheck.simulation.gasReselection === false, 'MAKER_INCOME_RESUME_RETURN')
        assertMakerProductIncomeSimulationInputs(result.recheck.simulation, result.reviewed)
        message = '原字节模拟核对完成；原件、Gas、阶段均未替换。这不代表签名资格或到账。'
      }
      publish({ ...empty(), message, execution, withdrawal })
    } catch (error) { publish({ ...empty(), error: error instanceof Error ? error.message : 'Product 原件核对未完成。' }) }
    finally { if (same() && serial.current === id) busy.current = false }
  }
  const historyView = original && history?.fundKey === makerProductIncomeFundKey(original.target) && history.controller === controller ? history.records : []
  async function readHistory() {
    if (!same() || !original) return
    const id = ++serial.current, load = loading.current, fundKey = makerProductIncomeFundKey(original.target)
    const valid = () => same() && serial.current === id && loading.current === load && frame.current.controller === controller
    try {
      const records = await browserMakerProductIncomeOriginalReader().history(fundKey)
      setHistory(previous => valid() ? { fundKey, controller, records } : previous)
    } catch (error) { setState(previous => valid() && previous.generation === generation ? { ...previous, error: error instanceof Error ? error.message : '归档不可读。' } : previous) }
  }
  function stop() { if (!same()) return; loading.current++; const id = ++serial.current; active.current?.abort(); busy.current = false; setState(previous => same() && serial.current === id ? { ...empty(), withdrawal: previous.generation === generation ? previous.withdrawal : null, message: '已停止本页等待；已开始的写读仍持锁至完成。原件保留。' } : previous) }
  return <section aria-label="Product 原提款恢复" className="space-y-4 rounded-xl border p-4">
    <p>当前钱包：{viewerAddress ?? '未连接'}。查询和下载不要求来源资格或钱包；继续模拟需要当前 Root 来源和原操作人的当前 Control。</p>
    <button type="button" onClick={() => void discover()}>刷新本机 Product 原件</button>
    {loadError && <p role="alert">{loadError}</p>}
    {!heads.length && <p>没有已发现的本机 Product 原件；可导入原文件查询。</p>}
    {heads.map(record => <button type="button" key={makerProductIncomeFundKey(record.plan)} onClick={() => select(record)} className="block break-all">选择 Product {record.plan.productId} · {record.packet.phase} · {record.packet.digest}</button>)}
    <label>原文件文本<textarea aria-label="Product 原文件文本" value={draft} onChange={event => setDraft(event.currentTarget.value)}/></label>
    <button type="button" onClick={() => importText(draft)}>导入 Product 原文件</button>
    <input ref={fileInput} aria-label="选择 Product 原文件" type="file" accept=".json,application/json" onClick={() => chooseFile(undefined)} onChange={event => chooseFile(event.currentTarget.files?.[0])}/>
    {original && text && <article aria-label="选定 Product 原件" className="space-y-2 break-all">
      <p>Product：{original.target.productId} · 原交易：{original.packet.digest}</p>
      <p>原 Control：{original.intent.controlId} · 原操作人：{original.intent.actor}</p>
      <p>原金额：{original.intent.amount} · 原收款人：{original.intent.recipient}</p>
      <p>载入时本机阶段：{selected?.packet.phase ?? '文件导入'}；阶段元数据不证明签名有效或链上成功。</p>
      <a download={`maker-product-income-${original.packet.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}>下载 Product 原提款恢复文件</a>
      <button type="button" disabled={view.pending} onClick={() => void action('query')}>查询 Product 原提款</button>
      <button type="button" disabled={!resumeAvailable || view.pending || mutationAttempt.current === generation} onClick={() => void action('resume')}>重新模拟 Product 原字节</button>
      {executeAvailable && <button type="button" disabled={view.pending || mutationAttempt.current === generation}
        onClick={() => void action('execute')}>
        {selected?.packet.phase === 'SIGNED' ? '核对并提交已签名 Product 原提款' : '核对并签名提交 Product 原提款'}
      </button>}
      {retireAvailable && <button type="button" disabled={view.pending || mutationAttempt.current === generation}
        onClick={() => void action('retire')}>核对并归档过期 Product 原提款</button>}
      {selected?.retirement && <p>归档证据：检查点 {selected.retirement.checkpoint.sequenceNumber} · Epoch {selected.retirement.checkpoint.epoch}
        {' · '}Product 版本 {selected.retirement.product.version} · 核对收据 {selected.retirement.tableSize} 项。</p>}
      <button type="button" disabled={!cancelAvailable || view.pending || mutationAttempt.current === generation} onClick={() => void action('cancel')}>取消本机未签名准备</button>
      {!resumeAvailable && <p>当前不具备继续模拟条件；原查询和下载仍可使用。</p>}
      <button type="button" disabled={view.pending} onClick={() => void readHistory()}>读取 Product 归档原件</button>
      {historyView.map(record => <button type="button" className="block" key={`${record.packet.digest}:${record.packet.phase}`} onClick={() => select(record)}>选择归档 {record.packet.phase} · {record.packet.digest}</button>)}
    </article>}
    {view.pending && <><p role="status">正在核对 Product 原件…</p><button type="button" onClick={stop}>停止 Product 原件核对</button></>}
    {view.error && <p role="alert">{view.error}。请保留原文件，不能据此重新提款。</p>}
    {view.message && <p role="status">{view.message}</p>}
    {view.execution && <IncomeOriginalExecutionObservation observation={view.execution}/>}
    {view.withdrawal && <>
      <MakerProductWithdrawalProof withdrawal={view.withdrawal}/>
      <IncomeWithdrawalAddressFunds key={generation} original={view.withdrawal} client={controller.client} viewerAddress={viewerAddress} observePayoutCoin/>
    </>}
    {original && <MakerProductCurrentLedger key={generation} target={original.target} client={controller.client}/>}
    <a href="/income/maker">重新观察 Product 收益</a>
  </section>
}

function MakerProductWithdrawalProof({ withdrawal }: { withdrawal: ConfirmedWithdrawal }) {
  const proof = withdrawal.receipt, receipt = proof.receipt
  return <article aria-label="原 Product 提款资金证据" className="space-y-2 break-all rounded-xl border p-4">
    <h3 className="font-medium">已核验原 Product 提款</h3>
    <p>原交易：{proof.transactionDigest} · 确认检查点：{withdrawal.checkpoint}</p>
    <p>Product：{receipt.root} · 原 Control：{proof.inputControl.objectId}</p>
    <p>收款人：{receipt.recipient} · 实收金额（最小单位）：{receipt.amount} · 币种：{proof.coinType}</p>
    <p>原收款 Coin：{proof.paymentCoinId} · 原 Gas 净费用（MIST）：{proof.gas.netGasCharge}</p>
    <p>原 Product 修订：{receipt.before_revision} → {receipt.after_revision} · 原交易后账本余额：{receipt.balance}</p>
    <p>原交易后累计收入：{receipt.total_collected} · 累计提款：{receipt.total_withdrawn}</p>
  </article>
}

type Ledger = Awaited<ReturnType<typeof readMakerProductIncome>>
function MakerProductCurrentLedger({ target, client }: { target: MakerProductIncomeTarget; client: RootMakerProductIncomeController['client'] }) {
  const session = useCommittedSession(publicMutationCanonical(target), null, client, null)
  const [view, setView] = useSessionState(session, { pending: false, ledger: null as Ledger | null, error: null as string | null })
  const active = useRef<AbortController | null>(null)
  async function read() {
    const lease = session.capture()
    if (!lease?.matches() || lease.isRunning()) return
    const abort = new AbortController()
    active.current = abort
    lease.requests.add(abort)
    lease.setRunning(true)
    setView(previous => ({ ...previous, pending: true, error: null }))
    const valid = () => lease.matches() && !abort.signal.aborted
    try {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45000)])
      const value = await profileReadStep(signal, () => readMakerProductIncome({ client: client(signal), target, signal }))
      if (valid()) setView({ pending: false, ledger: value, error: null })
    } catch (error) {
      if (valid()) setView(previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : '当前 Product 账本暂不可用。' }))
    } finally {
      lease.requests.delete(abort)
      if (active.current === abort) active.current = null
      lease.setRunning(false)
    }
  }
  function stop() {
    active.current?.abort()
    setView(previous => ({ ...previous, pending: false, error: null }))
  }
  const ledger = view.ledger
  return <section aria-label="当前 Product 账本" className="space-y-2 rounded-xl border p-4">
    <h3 className="font-medium">核对当前 Product 账本</h3>
    <button type="button" disabled={view.pending} onClick={() => void read()}>读取当前 Product 账本</button>
    {view.pending && <><p role="status">正在核对当前 Product 账本…</p><button type="button" onClick={stop}>停止 Product 账本查询</button></>}
    {view.error && <p role="alert">当前 Product 账本查询未完成：{view.error}</p>}
    {ledger && (view.pending || view.error) && <p role="status">显示最近一次成功观察。</p>}
    {ledger && <article aria-label="已读取当前 Product 账本" className="space-y-1 break-all text-sm">
      <p>Product：{ledger.object.objectId} · 对象版本：{ledger.object.version} · 币种：{ledger.coinType}</p>
      <p>当前账本余额（最小单位）：{ledger.ledger.balance} · 修订：{ledger.ledger.revision}</p>
      <p>累计收入：{ledger.ledger.collected} · 累计提款：{ledger.ledger.withdrawn}</p>
    </article>}
    <p>当前账本独立读取；继续提款需要重新核对当前 Control 和发布资格。</p>
  </section>
}
