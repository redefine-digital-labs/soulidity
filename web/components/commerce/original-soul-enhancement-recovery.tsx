'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button, buttonStyles } from '../ui/button'
import { Input } from '../ui/input'
import { SuiGrpcClient, type SuiGrpcClient as ReadClient } from '@mysten/sui/grpc'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { getSuiGrpcFullnodeUrl } from '@soulidity/sdk'
import { withPackageObjectIdentity } from '../../lib/sui/package-object-client'
import { importOriginalSoulEnhancementOriginal, ORIGINAL_SOUL_ENHANCEMENT_RECORD_LIMIT, type OriginalSoulEnhancementOriginal } from '../../lib/soulidity/commerce/original-soul-enhancement-original'
import { queryOriginalSoulEnhancementOriginal } from '../../lib/soulidity/commerce/original-soul-enhancement-original-result'

function defaultClient(signal: AbortSignal) {
  return withPackageObjectIdentity(new SuiGrpcClient({ network: 'mainnet', transport: new GrpcWebFetchTransport({ baseUrl: getSuiGrpcFullnodeUrl('mainnet'), abort: signal }) }), signal)
}
type Factory = (signal: AbortSignal) => ReadClient
type Result = Awaited<ReturnType<typeof queryOriginalSoulEnhancementOriginal>>
type View = { soulId: string; factory: Factory; name: string; text: string; original: OriginalSoulEnhancementOriginal | null;
  result: Result | null; pending: boolean; importing: boolean; error: string | null; stopped: boolean }
const status = (result: Result) => result.execution.status === 'MISSING' ? '本次未查到原交易，结果仍未知。请保留原记录，暂不重复购买。'
  : result.execution.status === 'PENDING' ? '已找到原交易，仍需等待最终确认。'
    : result.execution.status === 'FAILED' ? '原交易已确认失败；这不表示没有产生 Gas 费用。'
      : '原交易执行已确认。内容应用、交付和费用归属仍需核对。'

/** Memory-only original recovery. Pure known-schema validation reconstructs
 * full frozen bytes offline; actual query captures only ledger read leaves.
 * No wallet/store/locks, current source provider, prepare/simulate/sign/execute.
 */
export function OriginalSoulEnhancementRecovery({ soulId, createReadOnlyClient = defaultClient }: { soulId: string; createReadOnlyClient?: Factory }) {
  const target = isValidSuiAddress(soulId) ? normalizeSuiAddress(soulId) : null
  const usable = target !== null && !/^0x0+$/.test(target)
  const serial = useRef(0), active = useRef<AbortController | null>(null), current = useRef({ soulId, factory: createReadOnlyClient })
  const fileInput = useRef<HTMLInputElement | null>(null), pickerCancel = useRef<() => void>(() => {})
  current.current = { soulId, factory: createReadOnlyClient }
  const empty = (): View => ({ soulId, factory: createReadOnlyClient, name: '', text: '', original: null, result: null, pending: false, importing: false, error: null, stopped: false })
  const [state, setState] = useState<View>(empty)
  useEffect(() => { const id = ++serial.current; active.current?.abort(); publish(id, empty); return () => { serial.current++; active.current?.abort() } }, [soulId, createReadOnlyClient])
  const view = state.soulId === soulId && state.factory === createReadOnlyClient ? state : empty()
  const valid = (id: number) => serial.current === id && current.current.soulId === soulId && current.current.factory === createReadOnlyClient
  function publish(id: number, update: (previous: View) => View, signal?: AbortSignal) {
    if (!valid(id) || signal?.aborted) return
    // React may evaluate/replay a queued updater after a newer user action.
    // Recheck the lease at commit evaluation, including the captured identity.
    setState(previous => valid(id) && !signal?.aborted ? update(previous) : previous)
  }
  function interruptSelection() {
    const id = ++serial.current; active.current?.abort()
    publish(id, () => ({ ...view, pending: false, importing: false, result: null, error: null, stopped: Boolean(view.original) }))
  }
  pickerCancel.current = interruptSelection
  // React's input event map does not include the native file-picker cancel
  // event. Keep a native listener that always calls the current render lease.
  useEffect(() => {
    const input = fileInput.current, cancel = () => pickerCancel.current()
    input?.addEventListener('cancel', cancel)
    return () => input?.removeEventListener('cancel', cancel)
  }, [])
  async function select(file: File | undefined) {
    if (!file) { interruptSelection(); return }
    const id = ++serial.current; active.current?.abort(); publish(id, () => ({ ...empty(), name: file.name, importing: true }))
    let text = ''
    try {
      if (!usable) throw Error('SOUL_SCOPE')
      if (file.size === 0 || file.size > ORIGINAL_SOUL_ENHANCEMENT_RECORD_LIMIT) throw Error('FILE_BOUND')
      text = await file.text(); if (!valid(id)) return
      const loaded = await importOriginalSoulEnhancementOriginal(text)
      if (loaded.record.plan.soulId !== target) throw Error('SOUL_MISMATCH')
      publish(id, () => ({ ...empty(), name: file.name, text: loaded.originalText, original: loaded.record }))
    } catch (cause) {
      if (!valid(id)) return
      const code = cause instanceof Error ? cause.message : ''
      const error = code === 'SOUL_MISMATCH' ? '原记录属于另一个 Soul。已保留原文，请到对应 Soul 的恢复页查询。'
        : code === 'SOUL_SCOPE' ? '当前 Soul 身份无效，无法导入或查询。'
          : code === 'FILE_BOUND' ? '请选择大小有效的原增强恢复文件。'
            : '原增强记录无法核对。已读取的原文仍可下载；不会查询或发起新购买。'
      publish(id, () => ({ ...empty(), name: file.name, text, error }))
    }
  }
  async function query() {
    if (!usable || !target || !view.original || view.pending) return
    const original = view.original, text = view.text, id = ++serial.current, controller = new AbortController()
    active.current?.abort(); active.current = controller; publish(id, () => ({ ...view, pending: true, result: null, error: null, stopped: false }), controller.signal)
    try {
      const client = createReadOnlyClient(controller.signal)
      const result = await queryOriginalSoulEnhancementOriginal({ text, soulId: target, chainIdentifier: original.plan.chainIdentifier, author: original.plan.author, client, signal: controller.signal })
      publish(id, () => ({ ...view, result, pending: false, error: null, stopped: false }), controller.signal)
    } catch {
      publish(id, () => ({ ...view, result: null, pending: false, stopped: false, error: '原交易查询暂不可用。原文已保留，结果仍需核对；请勿据此重复购买。' }), controller.signal)
    }
  }
  function stop() { const id = ++serial.current; active.current?.abort(); publish(id, () => ({ ...view, pending: false, stopped: true })) }
  const original = view.original, total = original?.plan.construction.steps.reduce((sum, s) => sum + (s.kind === 'CONTRIBUTE' ? BigInt(s.amount) : 0n), 0n)
    ?? 0n
  const payment = original ? total + original.plan.construction.accessPlans.reduce((sum, row) => sum + BigInt(row.amount), 0n) : null
  return <section aria-label="原 Soul 内容增强恢复" className="space-y-3 rounded-xl border p-4">
    <h2 className="text-lg font-semibold">恢复原 Soul 内容增强</h2>
    <p>导入原增强恢复文件后，手动查询原交易。无需连接钱包；文件仅保留在本页内存中。</p>
    {!usable && <p role="alert">当前 Soul 身份无效，无法导入或查询。</p>}
    <label className="flex min-w-0 flex-col gap-2">原增强恢复文件<Input className="max-w-full" ref={fileInput} type="file" accept="application/json,.json" disabled={!usable} onClick={interruptSelection} onChange={event => void select(event.currentTarget.files?.[0])}/></label>
    {view.name && <p>已选择：{view.name}</p>}
    {view.importing && <p role="status">正在核对原记录…</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {view.text && <a className={buttonStyles({ variant: 'outline', className: 'max-w-full whitespace-normal! break-words' })} download={original ? `soul-enhancement-${original.packet.digest}.json` : 'original-soul-enhancement-unverified.json'}
      href={`data:application/json;charset=utf-8,${encodeURIComponent(view.text)}`} onClick={event => {
        const source = event.currentTarget, doc = source.ownerDocument, win = doc.defaultView
        if (!win || typeof win.URL.createObjectURL !== 'function' || typeof win.URL.revokeObjectURL !== 'function') return
        const link = doc.createElement('a'), revoke = win.URL.revokeObjectURL.bind(win.URL)
        const url = win.URL.createObjectURL(new win.Blob([view.text], { type: 'application/json' }))
        event.preventDefault(); link.href = url; link.download = source.getAttribute('download') ?? ''
        try { doc.body.append(link); link.click() }
        finally { link.remove(); win.setTimeout(() => revoke(url), 60000) }
      }}>下载导入的原增强文件</a>}
    {original && <article className="space-y-2 break-all">
      <p>原 Soul：{original.plan.soulId}</p><p>原交易：{original.packet.digest}</p>
      <p>原记录中的内容付款金额（最小单位）：{String(payment)}</p><p>币种：{original.plan.construction.context.target.coinType}</p><p>原记录中的 Gas 预算上限：{original.plan.gas.budget}</p>
      <p>文件中的阶段、签名和金额不代表已经付款、交付或可以再次购买。</p>
      <Button className="max-w-full whitespace-normal! break-words" type="button" disabled={view.pending || view.importing} onClick={() => void query()}>查询原增强交易</Button>
      {view.pending && <><p role="status">正在查询原增强交易…</p><Button className="max-w-full whitespace-normal! break-words" type="button" variant="outline" onClick={stop}>停止本次查询</Button></>}
      {view.stopped && <p role="status">已停止本页等待；链上交易没有因此取消。请保留原文件并继续核对原结果。</p>}
    </article>}
    {view.result && <p role="status">{status(view.result)}</p>}
    <p>本页不发起购买或签名。原交易查询不能代替当前内容、持有人和权限检查。</p>
  </section>
}
