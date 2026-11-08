'use client'

import { useRef } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { createNativeReceiveClient } from '../../lib/animacraft/native-receive'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { readNativePaidServiceCurrentFunds } from '../../lib/soulidity/commerce/native-paid-service-beneficiary-funds'
import {
  NATIVE_PAID_SERVICE_PACKET_MAX_BYTES,
  NATIVE_PAID_SERVICE_REVIEW_MAX_BYTES,
  queryNativePaidServiceRecoveryHistory,
} from '../../lib/soulidity/commerce/native-paid-service-recovery'

type History = Awaited<ReturnType<typeof queryNativePaidServiceRecoveryHistory>>
type Funds = Awaited<ReturnType<typeof readNativePaidServiceCurrentFunds>>
type Stage = 'history' | 'funds'
type View = {
  review: File | null
  packet: File | null
  history: History | null
  funds: Funds | null
  pending: Stage | null
  stopped: Stage | null
  error: string | null
}

const empty: View = { review: null, packet: null, history: null, funds: null, pending: null, stopped: null, error: null }

export function NativePaidServiceRecovery({ soulId, createReadOnlyClient = createNativeReceiveClient }: {
  soulId: string
  createReadOnlyClient?: (signal: AbortSignal) => SuiGrpcClient
}) {
  const session = useCommittedSession(soulId, null, createReadOnlyClient, null)
  const [view, setView] = useSessionState(session, empty)
  const active = useRef<AbortController | null>(null)

  function abort() {
    active.current?.abort()
    active.current = null
  }

  function select(key: 'review' | 'packet', file: File | null, limit: number) {
    abort()
    const valid = file && file.size > 0 && file.size <= limit
    setView(value => ({
      ...empty, review: value.review, packet: value.packet, [key]: valid ? file : null,
      error: file && !valid ? '文件为空或超过可查询大小。' : null,
    }))
  }

  async function run(stage: Stage, read: (signal: AbortSignal, current: () => boolean) => Promise<Partial<View>>) {
    const lease = session.capture()
    if (!lease?.matches() || (active.current && !active.current.signal.aborted)) return
    const controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const current = () => lease.matches() && active.current === controller && !controller.signal.aborted
    setView(value => ({ ...value, pending: stage, stopped: null, error: null }))
    try {
      const update = await read(controller.signal, current)
      if (current()) setView(value => ({ ...value, ...update, pending: null }))
    } catch (error) {
      if (current()) setView(value => ({ ...value, pending: null,
        error: error instanceof Error ? error.message : '本次查询暂不可用。' }))
    } finally {
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
    }
  }

  const verified = view.history?.status === 'ORIGINAL_SERVICE_BACKED_PROCEEDS' ? view.history : null
  const originalMoney = verified?.original.receipt.money
  function queryHistory() {
    const { review, packet } = view
    if (!review || !packet || verified) return
    void run('history', async (signal, current) => {
      const [reviewText, packetText] = await Promise.all([review.text(), packet.text()])
      if (!current()) return {}
      const history = await queryNativePaidServiceRecoveryHistory({ soulId, reviewText, packetText,
        client: createReadOnlyClient(signal), signal })
      return { history }
    })
  }

  function queryFunds() {
    if (!verified) return
    const originalProceeds = verified.originalProceeds
    void run('funds', async (signal, current) => ({
      funds: await readNativePaidServiceCurrentFunds({ originalProceeds, signal,
        client: createReadOnlyClient(signal), viewerAddress: originalProceeds.owner,
        getViewerAddress: () => current() ? originalProceeds.owner : null }),
    }))
  }

  const funds = view.funds
  const pendingHistory = view.history?.status === 'ORIGINAL_PROCEEDS_NOT_CONFIRMED' ? view.history : null
  return <section aria-label="原 Native 服务收款恢复" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">核对原 Native 服务收款</h2>
    <p>选择本 Soul 的服务审查 JSON 和原交易 JSON。查询通过公开链上数据完成，文件保留在本页内存中。</p>
    <label className="block">原服务审查 JSON
      <input type="file" accept="application/json,.json" onChange={event => {
        select('review', event.currentTarget.files?.[0] ?? null, NATIVE_PAID_SERVICE_REVIEW_MAX_BYTES)
        event.currentTarget.value = ''
      }}/>
    </label>
    {view.review && <p className="break-all">{view.review.name}</p>}
    <label className="block">原服务付款 JSON
      <input type="file" accept="application/json,.json" onChange={event => {
        select('packet', event.currentTarget.files?.[0] ?? null, NATIVE_PAID_SERVICE_PACKET_MAX_BYTES)
        event.currentTarget.value = ''
      }}/>
    </label>
    {view.packet && <p className="break-all">{view.packet.name}</p>}
    <button type="button" disabled={!view.review || !view.packet || Boolean(view.pending || verified)}
      className="rounded border px-3 py-1" onClick={queryHistory}>查询原服务收款</button>
    {view.pending && <><p role="status">{view.pending === 'history' ? '正在核对原服务付款…' : '正在查询收款地址当前资金…'}</p>
      <button type="button" onClick={() => {
        abort()
        setView(value => ({ ...value, stopped: value.pending, pending: null }))
      }}>停止服务收款查询</button></>}
    {view.stopped && <p role="status">{view.stopped === 'history'
      ? '已停止原服务付款查询。可用原文件继续核对同一摘要。'
      : '已停止当前资金查询。已核验的原服务收款仍可查看。'}</p>}
    {view.error && <p role="alert">服务收款查询未完成。{view.error.endsWith('PAID_SERVICE_RECOVERY_SOUL')
      ? '原服务审查文件属于另一个 Soul。' : view.error}</p>}
    {pendingHistory && <p role="status">原交易 {pendingHistory.transactionDigest} · {pendingHistory.original.status === 'FAILED'
      ? '链上已确认原付款失败。' : pendingHistory.original.status === 'PENDING'
        ? '已找到原交易，等待检查点确认。请用同一摘要继续查询。'
        : '本次未查到原交易，结果仍未知。请用同一摘要继续查询。'}</p>}
    {verified && originalMoney && <article aria-label="已核验原服务收款" className="space-y-2 break-all">
      <p>原服务绑定、Offer、受款 Coin 和协议入账已核验。</p>
      <p>原交易 {verified.transactionDigest} · 确认检查点 {verified.original.checkpoint}</p>
      <p>服务 {verified.originalProceeds.serviceId} · 受款地址 {verified.originalProceeds.owner}</p>
      <p>原收款 Coin {verified.originalProceeds.coinId} · 币种 {verified.originalProceeds.coinType}</p>
      <p>原买方总额 {originalMoney.buyerGrossDebit} · 原收款 {verified.originalProceeds.amount} · 原协议入账 {originalMoney.protocolIncome}（最小单位）</p>
      <p>原 SUI Gas（MIST）{originalMoney.gas.netGasCharge}</p>
      <p>这笔收款来自原 Offer 的受款分账。内容交付与提款权限由各自入口独立核验。</p>
      <button type="button" disabled={Boolean(view.pending)} className="rounded border px-3 py-1"
        onClick={queryFunds}>查询原服务受款地址当前资金</button>
    </article>}
    {funds && <article aria-label="原服务受款地址当前资金" className="space-y-2">
      <p>各项当前资金来自独立观察。原收款以历史证明为准。</p>
      <p>{funds.payout.status === 'OBSERVED' ? funds.payout.value.observations.map(row =>
        row.status === 'CURRENTLY_OWNED' ? `原收款 Coin 当前余额 ${row.currentCoinBalance}`
          : row.status === 'OTHER_OWNER' ? '原收款 Coin 当前由其他地址持有。' : '原收款 Coin 当前无法查询。').join(' ')
        : '原收款 Coin 当前无法查询。'}</p>
      <p>{funds.inventory.status === 'OBSERVED' ? `当前 Coin 对象合计 ${funds.inventory.value.observedCoinBalance}` : '当前 Coin 对象清单暂不可用。'}</p>
      <p>{funds.balance.status === 'OBSERVED'
        ? `当前 Coin 余额 ${funds.balance.value.coinBalance} · 地址余额 ${funds.balance.value.addressBalance} · 币种合计 ${funds.balance.value.balance}`
        : '当前 Coin 与地址余额暂不可用。'}</p>
    </article>}
  </section>
}
