'use client'

import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useRef } from 'react'
import { marketListDigest } from '../../lib/animacraft/market-list-operation'
import { createNativeReceiveClient } from '../../lib/animacraft/native-receive'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { parseCanonicalNativeWorkbenchTarget } from '../../lib/soulidity/canonical-native-workbench'
import { readNativeSaleCancellationByDigest } from '../../lib/soulidity/commerce/native-sale-cancellation'

type History = Awaited<ReturnType<typeof readNativeSaleCancellationByDigest>>
const empty = { digest: '', pending: false, stopped: false, history: null as History | null, error: null as string | null }

export function NativeSaleCancellationRecovery({ soulId, releaseJson, createReadOnlyClient = createNativeReceiveClient }: {
  soulId: string; releaseJson?: string; createReadOnlyClient?: (signal: AbortSignal) => SuiGrpcClient
}) {
  const session = useCommittedSession(JSON.stringify([soulId, releaseJson]), null, createReadOnlyClient, null)
  const [view, setView] = useSessionState(session, empty)
  const active = useRef<AbortController | null>(null)
  const digest = view.digest.trim()

  function stop() {
    active.current?.abort()
    active.current = null
    setView({ ...empty, digest: view.digest, stopped: true })
  }

  async function query() {
    const lease = session.capture()
    if (!lease?.matches() || (active.current && !active.current.signal.aborted) || !releaseJson || !marketListDigest(digest)) return
    const controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const current = () => lease.matches() && !controller.signal.aborted && active.current === controller
    setView({ ...empty, digest: view.digest, pending: true })
    try {
      const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
      if (!target.custody) throw Error('取消恢复需要原发布的 Custody 配置。')
      const history = await readNativeSaleCancellationByDigest({ soulId, digest, native: target.native, custody: target.custody,
        client: createReadOnlyClient(controller.signal), signal: controller.signal })
      if (current()) setView({ ...empty, digest: view.digest, history })
    } catch (error) {
      if (current()) setView({ ...empty, digest: view.digest,
        error: error instanceof Error ? error.message : '原取消交易暂不可查询。' })
    } finally {
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
    }
  }

  const history = view.history
  return <section aria-label="原取消挂牌恢复" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">核对原取消挂牌</h2>
    <p>使用原交易摘要和对应的 Native、Custody 发布配置核对历史。查询无需钱包。</p>
    {!releaseJson && <p>此发布的独立 Commerce 取消恢复需要配置 Native 和 Custody。</p>}
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void query() }}>
      <label className="block">原取消交易摘要
        <input className="block w-full rounded border px-3 py-1" value={view.digest} maxLength={64} disabled={view.pending}
          onChange={event => setView({ ...empty, digest: event.currentTarget.value })}/>
      </label>
      <button type="submit" disabled={view.pending || !releaseJson || !marketListDigest(digest)} className="rounded border px-3 py-1">查询原取消交易</button>
      {view.pending && <button type="button" onClick={stop}>停止取消历史查询</button>}
    </form>
    {view.pending && <p role="status">正在核对原交易和检查点…</p>}
    {view.stopped && <p role="status">查询已停止。可使用同一摘要继续核对。</p>}
    {view.error && <p role="alert">原取消证据未通过核对。{view.error}</p>}
    {history?.status === 'CANCELLATION_CONFIRMED' ? <article aria-label="原取消证据" className="space-y-2 break-all">
      <p>原取消交易、原挂牌退出及 Gas 已核验。</p>
      <p>原交易 {digest} · 确认检查点 {history.checkpoint}</p>
      <p>原 Offer {history.receipt.receipt.offer} · 卖家 {history.receipt.receipt.seller}</p>
      <p>原 SUI Gas（MIST）{history.receipt.gas.netGasCharge}</p>
      <p>后续挂牌与当前权限由当前状态独立核对。</p>
    </article> : history && <p role="status">{history.status === 'FAILED'
      ? '该摘要的取消交易已在链上确认失败。当前 Soul 的挂牌仍需单独核对。'
      : history.status === 'PENDING' ? '已找到原交易，终局仍待确认。请保留同一摘要。'
      : '本次未查到原交易，结果仍未知。请保留同一摘要继续核对。'}</p>}
  </section>
}
