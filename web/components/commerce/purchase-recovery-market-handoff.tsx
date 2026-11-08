'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { getBrowserNativeReceiveTarget } from '../../lib/animacraft/browser-native-config'
import { readBrowserNativeMarketBuyHandoff } from '../../lib/animacraft/browser-native-market-readback'
import type { MarketBuyCheckpointProof } from '../../lib/animacraft/market-buy-purchase-funds'
import type { MarketBuyFundsOriginal } from '../../lib/animacraft/market-buy-funds-original'

type Custody = Awaited<ReturnType<typeof readBrowserNativeMarketBuyHandoff>>

export function PurchaseRecoveryMarketHandoff({ file, soulId, settlement, client }: {
  file: MarketBuyFundsOriginal
  soulId: string
  settlement: MarketBuyCheckpointProof
  client: SuiGrpcClient
}) {
  const active = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [custody, setCustody] = useState<Custody | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  async function read() {
    active.current?.abort()
    const request = new AbortController()
    active.current = request
    setPending(true)
    setCustody(null)
    setError(null)
    try {
      const result = await readBrowserNativeMarketBuyHandoff({ file, soulId, client, settlement,
        target: getBrowserNativeReceiveTarget(), signal: request.signal })
      if (!request.signal.aborted) setCustody(result)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : '托管证据暂不可用。')
    } finally {
      if (!request.signal.aborted) setPending(false)
    }
  }

  return <article aria-label="Soul 原交付与当前托管" className="space-y-2 break-all">
    <button type="button" disabled={pending} onClick={() => void read()}>核对原 Soul 交付与当前托管</button>
    {pending && <p role="status">正在核对原交付和当前托管…</p>}
    {error && <p role="alert">Soul 托管核对未完成。{error}</p>}
    {custody && <>
      <p>原交付检查点 {custody.checkpoint} · 原 Soul {custody.soulId}</p>
      <p>原买家 {custody.originalBuyer} 已在该检查点接收 Soul。</p>
      <p>当前持有人 {custody.owner} · Kiosk {custody.kioskId} · 持有 Epoch {custody.ownershipEpoch}</p>
      <p>{custody.listed ? '当前已挂牌。' : '当前未挂牌。'}</p>
      {custody.status === 'SUPERSEDED' && <p>成交后托管或挂牌状态已有变化。</p>}
      <a href={`/souls/${encodeURIComponent(custody.soulId)}`}>打开当前 Soul，核对内容权限</a>
    </>}
  </article>
}
