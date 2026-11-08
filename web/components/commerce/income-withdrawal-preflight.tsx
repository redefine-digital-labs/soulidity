'use client'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { IncomeWithdrawalHostRecoveryError, validateIncomeWithdrawalHostResult, validateIncomeWithdrawalHostRecovery,
  type IncomeWithdrawalHostRequest, type IncomeWithdrawalHostPreflight } from '../../lib/soulidity/commerce/income-withdrawal-host-preflight'

export type IncomeWithdrawalPreflightInput = Omit<IncomeWithdrawalHostRequest, 'client' | 'signal' | 'getActorAddress'>
type Client = SuiGrpcClient | ((signal: AbortSignal) => SuiGrpcClient)
type Result = ReturnType<typeof validateIncomeWithdrawalHostResult>
type Recovery = ReturnType<typeof validateIncomeWithdrawalHostRecovery>

/** Root supplies the actual durable Host and its qualified activation. There
 * is no direct leaf-preflight fallback and no signer/submitter in this consumer.
 */
export function IncomeWithdrawalPreflight({ client, input, viewerAddress, hostPreflight = null, activationKey = '', disabledReason = null, isActivationCurrent = null }: {
  client: Client; input: IncomeWithdrawalPreflightInput; viewerAddress: string | null
  hostPreflight?: IncomeWithdrawalHostPreflight | null; activationKey?: string; disabledReason?: string | null
  isActivationCurrent?: (() => boolean) | null
}) {
  const scope = JSON.stringify([input, viewerAddress, activationKey, disabledReason], (_key, value) => typeof value === 'bigint' ? { bigint: String(value) } : value)
  const current = useRef({ scope, client, hostPreflight, viewerAddress, isActivationCurrent })
  useLayoutEffect(() => {
    current.current = { scope, client, hostPreflight, viewerAddress, isActivationCurrent }
  }, [scope, client, hostPreflight, viewerAddress, isActivationCurrent])
  const serial = useRef(0), active = useRef<AbortController | null>(null)
  const attempt = useRef<{ scope: string; client: Client; host: IncomeWithdrawalHostPreflight; lease: typeof isActivationCurrent } | null>(null)
  const empty = () => ({ scope, client, hostPreflight, isActivationCurrent, pending: false, attempted: false, stopped: false,
    result: null as Result | null, recovery: null as Recovery | null, error: null as string | null })
  const [state, setState] = useState(empty)
  const same = () => current.current.scope === scope && current.current.client === client && current.current.hostPreflight === hostPreflight && current.current.isActivationCurrent === isActivationCurrent
  const activationCurrent = () => { try { return isActivationCurrent === null || isActivationCurrent() === true } catch { return false } }
  useEffect(() => {
    const id = ++serial.current; active.current?.abort()
    setState(previous => same() && serial.current === id ? empty() : previous)
    return () => { serial.current++; active.current?.abort() }
  }, [scope, client, hostPreflight, isActivationCurrent])
  const view = state.scope === scope && state.client === client && state.hostPreflight === hostPreflight && state.isActivationCurrent === isActivationCurrent ? state : empty()
  const unavailable = disabledReason || (!activationKey || !activationCurrent() ? '此发布尚未开放提款预检。' : !hostPreflight ? '原提款保存与恢复服务尚未就绪。'
    : viewerAddress !== input.actor ? '请连接本次提款的管理钱包。' : null)
  async function prepare() {
    if (!same() || !activationCurrent() || unavailable || !hostPreflight || view.pending || view.attempted) return
    const host = hostPreflight
    if (attempt.current?.scope === scope && attempt.current.client === client && attempt.current.host === host && attempt.current.lease === isActivationCurrent) return
    attempt.current = { scope, client, host, lease: isActivationCurrent }
    const id = ++serial.current, controller = new AbortController(); active.current?.abort(); active.current = controller
    const valid = () => same() && activationCurrent() && serial.current === id && !controller.signal.aborted
    const publish = (value: ReturnType<typeof empty>) => setState(previous => valid() ? value : previous)
    publish({ ...empty(), pending: true, attempted: true })
    try {
      const values = structuredClone(input), reader = typeof client === 'function' ? client(controller.signal) : client
      const request = { ...values, client: reader, signal: controller.signal, getActorAddress: () => valid() ? current.current.viewerAddress : null }
      const checked = { ...structuredClone(values), client: reader, signal: controller.signal, getActorAddress: request.getActorAddress }
      const response = await host(request)
      if (!valid()) return
      const result = validateIncomeWithdrawalHostResult(checked, response)
      publish({ ...empty(), attempted: true, result })
    } catch (error) {
      if (!valid()) return
      let recovery: Recovery | null = null
      if (error instanceof IncomeWithdrawalHostRecoveryError) {
        try { recovery = validateIncomeWithdrawalHostRecovery(input.target, error.recovery) } catch { /* Never export an unverified or foreign funds original. */ }
      }
      publish({ ...empty(), attempted: true, recovery, error: error instanceof Error ? error.message : '提款预检未完成。' })
    }
  }
  function stop() {
    if (!same()) return
    const id = ++serial.current; active.current?.abort()
    setState(previous => same() && serial.current === id ? { ...empty(), attempted: true, stopped: true } : previous)
  }
  const text = view.result?.text ?? view.recovery?.text, digest = view.result?.digest ?? view.recovery?.digest
  return <section aria-label="新提款预检" className="space-y-3 rounded-xl border p-4">
    <h3 className="font-medium">核对新提款</h3>
    <p className="break-all text-sm">金额（最小单位）：{input.amount} · 币种：{input.target.coinType}</p>
    <p className="break-all text-sm">收款人：{input.recipient}</p>
    <p className="text-sm">先处理同一协议资金的旧提款。原件保存并读回后才模拟；本步骤不签名、不发送，也不表示已经收款。</p>
    {unavailable && <p role="status">{unavailable}</p>}
    <button type="button" disabled={Boolean(unavailable) || view.pending || view.attempted} onClick={() => void prepare()}>准备并模拟新提款</button>
    {view.pending && <><p role="status">正在核对旧操作、收入、权限、Gas 与原交易模拟…</p><button type="button" onClick={stop}>停止提款预检</button></>}
    {view.stopped && <p role="status">已停止本页等待。已开始的写入会继续保留操作锁直到结束，请到原提款恢复页核对，暂不重新准备。</p>}
    {view.error && <p role="alert">预检未完成：{view.error}。请保留原文件并核对原结果，不能据此再次提款。</p>}
    {view.result && <p role="status">原交易预检已完成；提款尚未签名或执行。本次模拟不代表到账或最终签名资格。</p>}
    {view.recovery && <div aria-label="保留的原提款信息" className="break-all">
      <p>原操作人：{view.recovery.actor} · 原收款人：{view.recovery.recipient} · 原金额：{view.recovery.amount}</p>
      <p>本机阶段：{view.recovery.headPhase}；此元数据不证明签名有效或链上成功。</p>
      <p>{view.recovery.durability === 'CONFIRMED' ? '主机已读回同一原件。' : '原件保存尚未确认，请先下载并核对原记录。'}</p>
    </div>}
    {text && digest && <article aria-label="原提款恢复文件" className="space-y-2 break-all">
      <p>原交易：{digest}</p><a download={`income-withdrawal-${digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}>下载原提款恢复文件</a>
      <p>文件保留原交易，不包含本次模拟或查询结果；下载不表示可以重新提款。</p>
    </article>}
    <a href="/income/recovery">打开原提款恢复页</a>
  </section>
}
