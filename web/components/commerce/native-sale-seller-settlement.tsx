'use client'

import React, { useState } from 'react'
import { marketListDigest } from '@/lib/animacraft/market-list-operation'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { PURCHASE_ORIGINAL_MAX_BYTES } from '@/lib/soulidity/commerce/purchase-recovery-original'
import { createNativePublicReadPaidOriginalClientV2 } from '@/lib/soulidity/native-public-read-paid-original-client-v2'
import type { NativeSellerRecord } from '@/lib/soulidity/native-sale-seller-journal'
import { exportNativeSaleListing, verifyNativeSaleSellerSettlement } from '@/lib/soulidity/native-sale-seller-settlement'

type Result = Awaited<ReturnType<typeof verifyNativeSaleSellerSettlement>>
const observations = { MISSING: '本次未查到原交易。', PENDING: '已找到原交易，等待终局。', FAILED: '已确认原交易失败。' }

async function readFile(file: File) {
  if (file.size === 0 || file.size > PURCHASE_ORIGINAL_MAX_BYTES) throw Error('原件须为 500 KB 以内的 JSON 文件。')
  return file.text()
}

export function NativeSaleSellerSettlement({ soulId, localListing }: { soulId: string; localListing: NativeSellerRecord | null }) {
  const [files, setFiles] = useState<{ listing?: File; purchase?: File }>({})
  const [digestText, setDigestText] = useState('')
  const digest = digestText.trim()
  const session = useCommittedSession(JSON.stringify([soulId, localListing?.packet.digest, digest]), files, undefined, undefined)
  const [view, setView] = useSessionState(session, { pending: false, result: null as Result | null, error: '' })
  const { result, pending } = view
  const listingText = localListing ? exportNativeSaleListing(localListing) : null
  const ready = Boolean((listingText || files.listing) && (!digest || marketListDigest(digest)))

  async function query() {
    const lease = session.capture(), { listing, purchase } = files
    if (!lease?.matches() || lease.isRunning() || !ready) return
    const controller = new AbortController(), signal = controller.signal
    const active = () => lease.matches() && !signal.aborted
    lease.requests.add(controller)
    lease.setRunning(true)
    setView({ pending: true, result: null, error: '' })
    try {
      const [list, buy] = await Promise.all([listing ? readFile(listing) : listingText!, purchase ? readFile(purchase) : undefined])
      if (!active()) return
      const result = await verifyNativeSaleSellerSettlement({ soulId, listingText: list,
        purchaseText: buy, closingDigest: digest || undefined,
        client: createNativePublicReadPaidOriginalClientV2(signal), signal })
      if (active()) setView({ pending: false, result, error: '' })
    } catch (error) {
      if (active()) setView({ pending: false, result: null, error: error instanceof Error ? error.message : '暂无法核对原成交。' })
    } finally {
      lease.requests.delete(controller)
      if (active()) lease.setRunning(false)
    }
  }

  function stop() {
    const lease = session.capture()
    if (!lease?.matches()) return
    for (const controller of lease.requests) controller.abort()
    lease.setRunning(false)
    setView({ pending: false, result: null, error: '' })
  }

  return <section aria-label="独立 Native 卖方成交核对" className="space-y-2 rounded border p-3">
    <h2>核对原挂牌成交与分账</h2>
    <p>使用本机挂牌原件或导入挂牌 JSON 后，可直接从链上 Offer 查找结束交易。也可输入结束交易摘要，或选择买方导出的原购买 JSON。</p>
    {localListing && listingText && <p className="break-all">本机原挂牌 {localListing.packet.digest} ·{' '}
      <a download={'listing-' + localListing.packet.digest + '.json'} href={'data:application/json;charset=utf-8,' + encodeURIComponent(listingText)}>下载原挂牌 JSON</a>
    </p>}
    <label className="block">原挂牌 JSON <input type="file" accept="application/json,.json" disabled={pending}
      onChange={event => { const listing = event.currentTarget.files?.[0]; setFiles(previous => ({ ...previous, listing })) }} /></label>
    <label className="block">结束交易摘要 <input value={digestText} maxLength={44} disabled={pending || Boolean(files.purchase)}
      onChange={event => setDigestText(event.currentTarget.value)} /></label>
    {digest && !marketListDigest(digest) && <p role="alert">结束交易摘要格式无效。</p>}
    <label className="block">买方原购买 JSON <input type="file" accept="application/json,.json" disabled={pending || Boolean(digest)}
      onChange={event => { const purchase = event.currentTarget.files?.[0]; setFiles(previous => ({ ...previous, purchase })) }} /></label>
    <button type="button" disabled={!ready || pending} onClick={() => void query()}>核对原挂牌与成交</button>
    {pending && <><p role="status">正在核对原挂牌和成交…</p><button type="button" onClick={stop}>停止成交查询</button></>}
    {view.error && <p role="alert">{view.error}</p>}
    {result && (result.status === 'SETTLEMENT_CONFIRMED' ? <article className="space-y-1 break-all" aria-label="已核对卖方原成交">
      <p role="status">已核对原挂牌、成交分账和买方托管交接。</p>
      <p>Offer {result.offerId} · 检查点 {result.checkpoint}</p>
      <p>挂牌摘要 {result.listingDigest}</p><p>购买摘要 {result.purchaseDigest}</p>
      <p>币种 {result.coinType} · 下列金额为最小单位</p>
      <p>卖方 {result.seller} · 标价款 {result.sellerAmount} · 钱包实收 {result.sellerReceived}</p>
      <p>作者 {result.creator} · 作者版税 {result.creatorRoyalty}</p>
      {result.collectionHolder && <p>合集持有人 {result.collectionHolder} · 合集版税 {result.collectionRoyalty}</p>}
      <p>协议收入 {result.protocolIncome}</p>
      <p>买方 {result.buyer} · 总价 {result.total} · 业务净扣款 {result.buyerNet} · Gas {result.gasMist} MIST</p>
      <ul aria-label="原成交收款 Coin">{result.payouts.map(row => <li key={row.coinId}>{row.owner} · {row.amount} · Coin {row.coinId}</li>)}</ul>
    </article> : result.status === 'CANCELLATION_CONFIRMED'
      ? <p role="status">已核对原挂牌取消与预留移除。Offer {result.offerId} · 摘要 {result.digest} · 检查点 {result.checkpoint}</p>
      : result.status === 'OFFER_ACTIVE'
        ? <p role="status">原 Offer {result.offerId} 仍处于挂牌状态。</p>
        : result.status === 'OFFER_UNAVAILABLE'
          ? <p role="status">原 Offer {result.offerId} 当前不可查询。可输入结束交易摘要继续查原件。</p>
          : <p role="status">{result.stage === 'LISTING' ? '原挂牌' : '结束交易'} {result.digest} · {observations[result.status]}</p>)}
  </section>
}
