'use client'

import React, { useState } from 'react'
import { canRetireNativeSaleOriginal } from '@/lib/soulidity/commerce/native-sale-original-retirement'
import { PurchaseRecoverySaleDelivery } from './purchase-recovery-sale-delivery'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { publicMutationCanonical } from '@/lib/sui/public-mutation-journal'
import { browserNativeSaleCheckoutJournal, nativeSaleCheckoutKey, type NativeSaleCheckoutRecord } from '@/lib/soulidity/native-sale-checkout-journal'
import { executeNativeSaleCheckout, prepareNativeSaleCheckout, recoverNativeSaleCheckout, reviewNativeSaleCheckout } from '@/lib/soulidity/native-sale-checkout'
import type { NativeSaleCheckoutRelease } from '@/lib/soulidity/native-sale-checkout-config'
import type { CanonicalNativeWorkbenchTarget } from '@/lib/soulidity/canonical-native-workbench'
import type { NativeSaleGraphPlan } from '@/lib/soulidity/commerce/native-sale-graph'

const normalize = (value: string) => isValidSuiAddress(value.trim()) ? normalizeSuiAddress(value.trim()) : ''
const ids = (value: string) => value.trim().split(/[\s,]+/).map(normalize)
const resultText = {
  MISSING: '本次未查到原摘要。',
  PENDING: '已找到原交易，等待终局。',
  FAILED: '已确认原交易失败。',
  RETIRED: '已核对原购买过期且未执行，可以重新核对报价并准备新交易。',
  SUCCEEDED: '已核对原成交分账、托管交接和授权变化。',
}

export function NativeSaleCheckout({ soulId, release, initialOffer = '', nativeReleaseJson }: {
  soulId: string; release: NativeSaleCheckoutRelease | null; initialOffer?: string; nativeReleaseJson?: string
}) {
  const wallet = useWalletSign(), buyer = wallet.suiWallet?.address ?? null
  const [offer, setOffer] = useState(initialOffer), [account, setAccount] = useState('')
  const [payments, setPayments] = useState(''), [gas, setGas] = useState(''), [budget, setBudget] = useState('')
  const offerId = normalize(offer)
  const session = useCommittedSession(publicMutationCanonical([soulId, release, offerId]), wallet.walletAccount, wallet.suiGrpcClient, wallet.currentWallet)
  const [view, setView] = useSessionState(session, { pending: false, review: null as Awaited<ReturnType<typeof reviewNativeSaleCheckout>> | null,
    record: null as NativeSaleCheckoutRecord | null, confirmedDigest: '', status: '', error: '' })
  const route = '/souls/' + encodeURIComponent(soulId) + '/purchase/recovery'
  const busy = view.pending
  const canPrepare = Boolean(buyer && release && view.review && normalize(account) && ids(payments).every(Boolean)
    && ids(gas).every(Boolean) && /^[1-9][0-9]{0,19}$/.test(budget))
  const original = view.record ? JSON.parse(view.record.plan.originalText) as {
    plan: NativeSaleGraphPlan; context: { target: CanonicalNativeWorkbenchTarget }
  } : null
  const recordPlan = original?.plan
  const confirmed = view.record && view.confirmedDigest === view.record.packet.digest
  const phase = view.record?.packet.phase
  const canExecute = Boolean(release && buyer && recordPlan?.offerId === offerId && ['PREPARED', 'SIGNING', 'SIGNED'].includes(phase ?? ''))

  async function run(action: 'review' | 'prepare' | 'load' | 'execute' | 'query' | 'cancel' | 'retire') {
    const lease = session.capture(), source = wallet.suiGrpcClient
    if (!buyer || !lease?.matches() || lease.isRunning() || !source) return
    const controller = new AbortController(), signal = controller.signal
    const active = () => lease.matches() && !signal.aborted && wallet.getWalletAddress() === buyer
    const getBuyerAddress = () => active() ? buyer : null
    if (!active()) return
    lease.setRunning(true); lease.requests.add(controller)
    setView(previous => ({ ...previous, pending: true, error: '', status: '', ...(action === 'review' ? { review: null } : {}) }))
    const key = nativeSaleCheckoutKey({ chainIdentifier: '35834a8a', soulId, author: buyer })
    const read = () => browserNativeSaleCheckoutJournal(true).read(key)
    try {
      const client = withPackageObjectIdentity(source, signal)
      if (action === 'review' && release) {
        const review = await reviewNativeSaleCheckout({ client, release, soulId, offerId, signal })
        const record = await read()
        if (active()) setView(previous => ({ ...previous, review, record }))
      } else if (action === 'prepare' && release && view.review && canPrepare) {
        const { record, prepared } = await prepareNativeSaleCheckout({ client, release, review: view.review, signal, buyer,
          buyerAccountId: normalize(account), paymentCoinIds: ids(payments), gasCoinIds: ids(gas), gasBudget: budget, getBuyerAddress })
        if (active()) setView(previous => ({ ...previous, record, status: prepared ? '原件已保存并通过模拟。' : '已读回现有原件，请先核对原摘要。' }))
      } else if (action === 'load') {
        const record = await read()
        if (active()) setView(previous => ({ ...previous, record, status: record ? '已读回本机原件。' : '本机没有此钱包的原购买。' }))
      } else if (view.record && action !== 'review' && action !== 'prepare') {
        const options = { record: view.record, client, signal }
        const result = action === 'execute' && release && canExecute
          ? await executeNativeSaleCheckout({ ...options, activeOfferId: offerId, activeRelease: release, getBuyerAddress,
            sign: tx => wallet.signTransaction(tx, { retainReturnedSignature: true }) })
          : await recoverNativeSaleCheckout({ ...options, ...(action === 'cancel' ? { cancelUnsigned: true } : {}),
            ...(action === 'retire' ? { retireExpired: true } : {}) })
        if (active()) setView(previous => ({ ...previous, record: result.record,
          confirmedDigest: result.result.status === 'SUCCEEDED' ? result.record.packet.digest : '', status: result.record.packet.phase === 'CANCELLED'
          ? '已保存本机取消，原件仍可查询。' : resultText[result.result.status] }))
      }
    } catch (error) {
      let record = view.record
      try { record = await read() } catch { /* Keep the last readable original. */ }
      if (active()) setView(previous => ({ ...previous, record, error: error instanceof Error ? error.message : '购买操作未完成。' }))
    } finally {
      lease.requests.delete(controller); lease.setRunning(false)
      if (active()) setView(previous => ({ ...previous, pending: false }))
    }
  }

  return <section className="space-y-4 p-6" aria-label="独立 Native Soul 购买">
    <h1>购买独立 Native Soul</h1><p className="break-all">Soul {soulId}</p>
    {!release && <p>此部署尚未获准执行独立 Native 购买。</p>}
    {!buyer && <p>连接买家钱包可核对原件与付款选项。</p>}
    <label className="block">Offer 对象 ID <input value={offer} disabled={busy} onChange={event => setOffer(event.currentTarget.value)} /></label>
    <button type="button" disabled={!buyer || !release || !offerId || busy} onClick={() => void run('review')}>核对 Offer 和总价</button>
    <button type="button" disabled={!buyer || busy} onClick={() => void run('load')}>读取本机原购买</button>
    {view.review && <div className="space-y-2 break-all">
      <p>卖方 {view.review.seller} · 作者 {view.review.creator}</p>
      {view.review.collectionHolder && <p>合集持有人 {view.review.collectionHolder}</p>}
      <p>标价 {view.review.ask} · 协议费 {view.review.platform} · 作者版税 {view.review.creatorRoyalty} · 合集版税 {view.review.collectionRoyalty}</p>
      <p>总价 {view.review.total}（最小单位） · {view.review.coinType}</p>
      <label className="block">买方 Account <input value={account} disabled={busy} onChange={event => setAccount(event.currentTarget.value)} /></label>
      <label className="block">付款 Coin IDs <input value={payments} disabled={busy} onChange={event => setPayments(event.currentTarget.value)} /></label>
      <label className="block">SUI Gas Coin IDs <input value={gas} disabled={busy} onChange={event => setGas(event.currentTarget.value)} /></label>
      <label className="block">Gas 预算（MIST） <input value={budget} disabled={busy} onChange={event => setBudget(event.currentTarget.value)} /></label>
      <button type="button" disabled={!canPrepare || busy} onClick={() => void run('prepare')}>保留原件并模拟</button>
    </div>}
    {view.record && recordPlan && <article className="space-y-2 break-all" aria-label="本机 Native 原购买">
      <p>原摘要 {view.record.packet.digest} · 本机阶段 {phase}</p>
      <p>原 Offer {recordPlan.offerId} · 原总价 {recordPlan.reviewedTotal} · {recordPlan.coinType}</p>
      <p>付款 Coin {recordPlan.paymentCoins.map(coin => coin.objectId).join('、')}</p>
      <p>Gas 预算 {recordPlan.gas.budget} MIST · {recordPlan.gas.coins.map(coin => coin.objectId).join('、')}</p>
      <a download={'purchase-' + view.record.packet.digest + '.json'} href={'data:application/json;charset=utf-8,' + encodeURIComponent(view.record.plan.originalText)}>下载原购买 JSON</a>
      <button type="button" disabled={busy} onClick={() => void run('query')}>查询原摘要</button>
      <button type="button" disabled={busy || phase !== 'PREPARED'} onClick={() => void run('cancel')}>取消本机未签名准备</button>
      <button type="button" disabled={busy || !canRetireNativeSaleOriginal(view.record.packet)} onClick={() => void run('retire')}>核对过期并归档原购买</button>
      {view.record.retirement && <p>过期证据检查点 {view.record.retirement.sequenceNumber} · Epoch {view.record.retirement.epoch}</p>}
      <button type="button" disabled={busy || !canExecute} onClick={() => void run('execute')}>{phase === 'SIGNED' ? '复核并提交原签名' : '复核并签名原购买'}</button>
    </article>}
    {busy && <p role="status">正在核对或处理原购买…</p>}
    {view.status && <p role="status">{view.status}</p>}
    {view.error && <p role="alert">{view.error} 请先查原摘要再操作。</p>}
    {original && confirmed && <PurchaseRecoverySaleDelivery releaseJson={nativeReleaseJson} savedTarget={original.context.target}
      soulId={soulId} buyer={original.plan.buyer} digest={view.confirmedDigest} />}
    <a href={route}>打开原成交和内容恢复</a>
  </section>
}
