'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { publicMutationCanonical } from '../../lib/sui/public-mutation-journal'
import type { MakerProductIncomeTarget } from '../../lib/soulidity/commerce/maker-product-income-read'
import type { RootMakerProductIncomeController, MakerProductIncomeObservation, MakerProductIncomeDraft, MakerProductIncomeReview } from '../../lib/soulidity/commerce/maker-product-income-controller'
import { MakerProductIncomeRecoveryError, validateMakerProductIncomeHostRecovery } from '../../lib/soulidity/commerce/maker-product-income-host-result'
import { MakerProductIncomePreflight } from './maker-product-income-preflight'

const emptyTarget = (): MakerProductIncomeTarget => ({ chainIdentifier: '35834a8a', protocolId: '', productId: '', coinType: '', manufacturing: { originalPackageId: '', callablePackageId: '', callableDigest: '' }, foundation: { originalPackageId: '', callablePackageId: '', callableDigest: '' } })
const emptyDraft = (): MakerProductIncomeDraft => ({ amount: '', recipient: '', gasBudget: '', gasPrice: '', gasCoinIds: [], expirationEpoch: '', attemptHex: '' })
type Recovery = ReturnType<typeof validateMakerProductIncomeHostRecovery>
export function MakerProductIncomeWorkbench({ controller, viewerAddress }: { controller: RootMakerProductIncomeController; viewerAddress: string | null }) {
  const [target, setTarget] = useState(emptyTarget), [sourceId, setSourceId] = useState<string | null>(null), [controlId, setControlId] = useState('')
  const [draft, setDraft] = useState(emptyDraft), [confirmed, setConfirmed] = useState(false), [locks, setLocks] = useState(false)
  const rootCurrent = controller.isCurrent()
  const identity = publicMutationCanonical([target, sourceId, controlId, viewerAddress, controller.catalogVersion, rootCurrent])
  const frame = useRef({ identity, controller, generation: 0, viewerAddress })
  if (frame.current.identity !== identity || frame.current.controller !== controller) frame.current = { identity, controller, generation: frame.current.generation + 1, viewerAddress }
  const generation = frame.current.generation, serial = useRef(0), reviewToken = useRef(0), active = useRef<AbortController | null>(null), busy = useRef(false)
  const same = () => frame.current.generation === generation && frame.current.controller === controller
  const empty = () => ({ generation, pending: false, observation: null as MakerProductIncomeObservation | null, recovery: null as Recovery | null, review: null as MakerProductIncomeReview | null, error: null as string | null, stopped: false })
  const [state, setState] = useState(empty), view = state.generation === generation ? state : empty()
  const sources = controller.installedSources()
  useEffect(() => {
    const id = ++serial.current; reviewToken.current++; active.current?.abort(); busy.current = false
    setLocks(typeof navigator !== 'undefined' && Boolean(navigator.locks?.request))
    setState(previous => same() && serial.current === id ? empty() : previous); setDraft(emptyDraft()); setConfirmed(false)
    return () => { serial.current++; reviewToken.current++; active.current?.abort() }
  }, [generation])
  function invalidate() { serial.current++; reviewToken.current++; active.current?.abort(); busy.current = false; setConfirmed(false) }
  function changeTarget(next: MakerProductIncomeTarget, keepSource = false) { invalidate(); setTarget(next); if (!keepSource) setSourceId(null) }
  function selectSource(value: string) {
    invalidate(); const installed = sources.entries.find(row => row.manifestSha256 === value)
    setSourceId(installed?.manifestSha256 ?? null); setTarget(installed ? { ...structuredClone(installed.manifest.deployment), productId: target.productId } : emptyTarget())
  }
  function changeDraft(next: MakerProductIncomeDraft) {
    reviewToken.current++; setDraft(next); setConfirmed(false)
    setState(previous => same() && previous.generation === generation ? { ...previous, review: null, error: null } : previous)
  }
  async function observe() {
    if (!same() || busy.current) return
    const id = ++serial.current, abort = new AbortController(); reviewToken.current++; active.current?.abort(); active.current = abort; busy.current = true
    const valid = () => same() && serial.current === id && !abort.signal.aborted
    setState(previous => valid() ? { ...empty(), pending: true, recovery: previous.generation === generation ? previous.recovery : null } : previous); setConfirmed(false); setDraft(emptyDraft())
    try {
      const value = await controller.observe({ target: structuredClone(target), actor: viewerAddress, controlId, installedSourceId: sourceId }, abort.signal, () => valid() ? frame.current.viewerAddress : null)
      setState(previous => valid() && controller.isCurrent() ? { ...empty(), observation: value } : previous)
    } catch (error) {
      let recovery: Recovery | null = null
      if (error instanceof MakerProductIncomeRecoveryError) { try { recovery = validateMakerProductIncomeHostRecovery(target, error.recovery) } catch { /* no foreign/unverified export */ } }
      setState(previous => valid() ? { ...empty(), error: error instanceof Error ? error.message : '收益观察未完成。', recovery: recovery ?? (previous.generation === generation ? previous.recovery : null) } : previous)
    } finally { if (same() && serial.current === id) busy.current = false }
  }
  function stop() {
    if (!same()) return
    invalidate(); setState(previous => same() ? { ...previous, pending: false, stopped: true, review: null } : previous)
  }
  function lockReview() {
    if (!same() || !confirmed || !view.observation || view.pending) return
    const token = ++reviewToken.current
    try {
      const review = controller.makeReview(view.observation, draft)
      setState(previous => same() && controller.isCurrent() && previous.generation === generation && reviewToken.current === token ? { ...previous, review, error: null } : previous)
    } catch (error) { setState(previous => same() && previous.generation === generation && reviewToken.current === token ? { ...previous, review: null, error: error instanceof Error ? error.message : '审阅资料无效。' } : previous) }
  }
  const token = reviewToken.current
  const lease = useMemo(() => () => same() && reviewToken.current === token && controller.isCurrent(), [controller, generation, token])
  const host = useMemo(() => view.review ? controller.createPreflight(view.review) : null, [controller, view.review])
  const income = view.observation?.income, preparation = view.observation?.preparation
  const fields: Array<[keyof MakerProductIncomeTarget['foundation'], string]> = [['originalPackageId', 'Foundation 原始包'], ['callablePackageId', 'Foundation 当前包'], ['callableDigest', '包对象 Digest']]
  return <section aria-label="Maker Product 收益工作台" className="space-y-4 rounded-xl border p-4">
    <label>Root 已安装来源<select aria-label="Root 已安装来源" value={sourceId ?? ''} onChange={event => selectSource(event.currentTarget.value)}><option value="">其他公开目标（仅观察）</option>{sources.entries.map(row => <option key={row.manifestSha256} value={row.manifestSha256}>{row.manifest.deployment.protocolId} · {row.manifest.deployment.coinType}</option>)}</select></label>
    {sources.error && <p role="alert">{sources.error}</p>}
    {!rootCurrent && <p role="status">来源安装版本已失效；新提款准备关闭，原件仍可独立查询。</p>}
    {!sources.entries.length && <p>当前没有已安装的真实部署资格。可核对公开 Product 账本；提款准备保持关闭。</p>}
    <label>协议 ID<input aria-label="协议 ID" value={target.protocolId} onChange={event => changeTarget({ ...target, protocolId: event.currentTarget.value })}/></label>
    <label>Product ID<input aria-label="Product ID" value={target.productId} onChange={event => changeTarget({ ...target, productId: event.currentTarget.value }, true)}/></label>
    <label>币种类型<input aria-label="币种类型" value={target.coinType} onChange={event => changeTarget({ ...target, coinType: event.currentTarget.value })}/></label>
    {fields.map(([key, label]) => <label key={key}>{label}<input aria-label={label} value={target.foundation[key]} onChange={event => changeTarget({ ...target, foundation: { ...target.foundation, [key]: event.currentTarget.value } })}/></label>)}
    {fields.map(([key, label]) => { const name = label.replace('Foundation', '制造').replace('包对象', '制造包对象'); return <label key={name}>{name}<input aria-label={name} value={target.manufacturing[key]} onChange={event => changeTarget({ ...target, manufacturing: { ...target.manufacturing, [key]: event.currentTarget.value } })}/></label> })}
    <p className="break-all">当前钱包：{viewerAddress ?? '未连接'}。钱包地址和收款地址不代替当前 Control 对象权限。</p>
    <label>Control 对象<input aria-label="Control 对象" value={controlId} onChange={event => { invalidate(); setControlId(event.currentTarget.value) }}/></label>
    <button type="button" disabled={view.pending} onClick={() => void observe()}>读取 Product 收益与当前资格</button>
    {view.pending && <><p role="status">先核对旧原件，再读取当前资料…</p><button type="button" onClick={stop}>停止收益观察</button></>}
    {view.stopped && <p>已停止等待；这不取消链上操作或允许再次提款。</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {view.recovery && <article aria-label="先处理原提款" className="break-all"><p>旧操作仍需恢复核对：{view.recovery.digest}</p><p>原操作人：{view.recovery.actor} · 原收款人：{view.recovery.recipient}</p><a download={`maker-product-income-${view.recovery.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(view.recovery.text)}`}>下载原提款恢复文件</a><a href="/income/maker/recovery">打开原提款恢复页</a></article>}
    {income && <article aria-label="当前 Product 收益" className="space-y-2 break-all">
      <p>账本余额（最小单位）：{income.ledger.balance}</p><p>累计收入：{income.ledger.collected} · 累计提款：{income.ledger.withdrawn} · 账本修订：{income.ledger.revision}</p>
      <p>币种：{income.coinType} · Product：{income.object.objectId}</p><p>Product 生命周期：{income.product.lifecycle}；暂停或归档不隐藏合法资金退出。</p>
      <p>{income.authority ? `已读回当前钱包的匹配 Control：${income.authority.objectId}` : '没有当前钱包的 Control 证明，仅显示Product 余额。'}</p>
      {view.observation?.disabledReason && <p role="status">{view.observation.disabledReason}</p>}
      <p>这笔余额是选定 Product 的当前账本，不是协议 Config 收入或已到账 Coin；观察不授予签名权限。</p>
    </article>}
    {preparation && <article aria-label="明确审阅提款" className="space-y-3">
      <p className="break-all">Root 来源清单：{preparation.source.manifestSha256}</p><p>观察 Epoch：{preparation.epoch} · 当前参考 Gas 价格：{preparation.referenceGasPrice}</p>
      <label>提款金额（最小单位）<input aria-label="提款金额" value={draft.amount} onChange={event => changeDraft({ ...draft, amount: event.currentTarget.value })}/></label>
      <label>收款地址<input aria-label="收款地址" value={draft.recipient} onChange={event => changeDraft({ ...draft, recipient: event.currentTarget.value })}/></label>
      <label>Gas 预算（SUI 最小单位）<input aria-label="Gas 预算" value={draft.gasBudget} onChange={event => changeDraft({ ...draft, gasBudget: event.currentTarget.value })}/></label>
      <label>Gas 价格<input aria-label="Gas 价格" value={draft.gasPrice} onChange={event => changeDraft({ ...draft, gasPrice: event.currentTarget.value })}/></label>
      <p>预算是 Gas 上限，不是最终费用；不会自动选择或更换 Gas 对象。</p>
      {preparation.addressGasBalance != null && <label className="block">
        <input type="checkbox" aria-label="使用 SUI 地址余额支付 Gas" checked={draft.useAddressGas === true}
          onChange={event => changeDraft({ ...draft, useAddressGas: event.currentTarget.checked, gasCoinIds: [], expirationEpoch: '' })}/>
        使用 SUI 地址余额支付 Gas · 余额 {preparation.addressGasBalance} MIST
      </label>}
      {!draft.useAddressGas && preparation.inventory.coins.map(coin => <label key={coin.objectId} className="block break-all"><input type="checkbox" aria-label={`选择 Gas ${coin.objectId}`} checked={draft.gasCoinIds.includes(coin.objectId)} onChange={event => changeDraft({ ...draft, gasCoinIds: event.currentTarget.checked ? [...draft.gasCoinIds, coin.objectId] : draft.gasCoinIds.filter(id => id !== coin.objectId) })}/>{coin.objectId} · 余额 {coin.balance} · version {coin.version} · digest {coin.digest}</label>)}
      {!draft.useAddressGas && !preparation.inventory.coins.length && <p>没有已核验的可选 SUI Coin 对象。</p>}
      <label>到期 Epoch<select aria-label="到期 Epoch" value={draft.expirationEpoch} onChange={event => changeDraft({ ...draft, expirationEpoch: event.currentTarget.value })}><option value="">明确选择有效期</option>{(draft.useAddressGas ? [String(BigInt(preparation.epoch) + 1n)] : [preparation.epoch, String(BigInt(preparation.epoch) + 1n)]).map(epoch => <option key={epoch} value={epoch}>{epoch}</option>)}</select></label>
      <label>操作标识（32字节十六进制）<input aria-label="操作标识" value={draft.attemptHex} onChange={event => changeDraft({ ...draft, attemptHex: event.currentTarget.value })}/></label>
      <label><input type="checkbox" aria-label="确认本次审阅" checked={confirmed} onChange={event => { const checked = event.currentTarget.checked; if (!checked) { reviewToken.current++; setState(previous => same() ? { ...previous, review: null } : previous) } setConfirmed(checked) }}/>已核对金额、收款人、原始单位、Gas 引用与费用上限。</label>
      <button type="button" disabled={!confirmed || view.pending} onClick={lockReview}>锁定本次审阅</button>
    </article>}
    {view.review && host && <MakerProductIncomePreflight key={`${generation}:${token}`} input={view.review.request} client={controller.client} viewerAddress={viewerAddress} hostPreflight={host}
      activationKey={`${controller.catalogVersion}:${view.review.observation.preparation!.source.manifestSha256}`} isActivationCurrent={lease}
      disabledReason={!locks ? '当前环境没有操作锁；只能观察或查询原件。' : null}/>}
    <a href="/income/maker/recovery">查询或继续原提款</a>
    <p>Maker 和 Pack 各自按 Product ID 核对资金；共享协议不会合并它们的账本。</p>
  </section>
}
