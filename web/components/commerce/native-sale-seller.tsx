'use client'

import React, { useState } from 'react'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { publicMutationCanonical } from '@/lib/sui/public-mutation-journal'
import { readNativeSellerReview, type NativeSellerIntent } from '@/lib/soulidity/commerce/native-sale-seller-plan'
import { createNativePublicReadPaidOriginalClientV2 } from '@/lib/soulidity/native-public-read-paid-original-client-v2'
import type { NativeSaleCheckoutRelease } from '@/lib/soulidity/native-sale-checkout-config'
import { executeNativeSellerOriginal, prepareNativeSellerOriginal, reconcileNativeSellerOriginal } from '@/lib/soulidity/native-sale-seller'
import { browserNativeSellerJournal, discoverNativeSellerRecords, nativeSellerKey, nativeSellerScope,
  queryNativeSellerOriginal, type NativeSellerRecord } from '@/lib/soulidity/native-sale-seller-journal'

const address = (value: string) => isValidSuiAddress(value.trim()) ? normalizeSuiAddress(value.trim()) : ''
const positive = (value: string) => /^[1-9][0-9]{0,19}$/.test(value)
const resultText = { MISSING: '本次未查到原摘要。', PENDING: '已找到原交易，等待终局。', FAILED: '已确认原交易失败。' }
type Result = Awaited<ReturnType<typeof queryNativeSellerOriginal>>

export function NativeSaleSeller({ soulId, release }: { soulId: string; release: NativeSaleCheckoutRelease | null }) {
  const wallet = useWalletSign(), seller = wallet.suiWallet?.address ?? null
  const [kind, setKind] = useState<NativeSellerIntent['kind']>('LIST')
  const [account, setAccount] = useState(''), [policy, setPolicy] = useState(''), [ask, setAsk] = useState('')
  const [collection, setCollection] = useState(''), [offer, setOffer] = useState('')
  const [gas, setGas] = useState(''), [budget, setBudget] = useState('')
  const gasCoinIds = gas.trim().split(/[\s,]+/).map(address)
  const intent = seller && address(account)
    ? kind === 'LIST' && address(policy) && positive(ask) && (!collection.trim() || address(collection))
      ? { kind, seller, soulId, accountId: address(account), policyId: address(policy), ask, collectionId: address(collection) || null }
      : kind === 'CANCEL' && address(offer)
        ? { kind, seller, soulId, accountId: address(account), offerId: address(offer) }
        : null
    : null
  const session = useCommittedSession(publicMutationCanonical([soulId, release, kind, intent]), wallet.walletAccount, wallet.suiGrpcClient, wallet.currentWallet)
  const [view, setView] = useSessionState(session, { busy: false, review: null as Awaited<ReturnType<typeof readNativeSellerReview>> | null,
    record: null as NativeSellerRecord | null, records: [] as NativeSellerRecord[], result: null as Result | null, status: '', error: '' })
  const { record, result, busy } = view
  const phase = record?.packet.phase
  const sameSeller = Boolean(seller && record?.plan.intent.seller === seller)
  const canExecute = Boolean(sameSeller && release && record && publicMutationCanonical(record.plan.release) === publicMutationCanonical(release)
    && ['PREPARED', 'SIGNING', 'SIGNED'].includes(phase ?? ''))
  const canPrepare = Boolean(view.review && gasCoinIds.every(Boolean) && positive(budget))
  const buyRoute = '/souls/' + encodeURIComponent(soulId) + '/buy/native'

  async function run(action: 'review' | 'prepare' | 'load' | 'execute' | 'query' | 'discard') {
    const lease = session.capture()
    if (!lease?.matches() || lease.isRunning()) return
    const controller = new AbortController(), signal = controller.signal
    const active = () => lease.matches() && !signal.aborted
    const getSellerAddress = () => active() ? wallet.getWalletAddress() : null
    const source = wallet.suiGrpcClient
    const walletClient = seller && source && getSellerAddress() === seller ? source : null
    const read = () => seller ? browserNativeSellerJournal(true).read(nativeSellerKey({ chainIdentifier: '35834a8a', soulId, author: seller })) : null
    lease.setRunning(true)
    lease.requests.add(controller)
    setView(previous => ({ ...previous, busy: true, error: '', status: '', result: null, ...(action === 'review' ? { review: null } : {}) }))
    try {
      if (action === 'load') {
        const records = await discoverNativeSellerRecords(soulId)
        const head = await read()
        if (active()) setView(previous => ({ ...previous, records, record: head ?? records[0] ?? null,
          status: records.length ? '已读回本机原件。' : '本机没有此 Soul 的挂牌或取消原件。' }))
      } else if ((action === 'review' || action === 'prepare') && release && intent && walletClient) {
        const input = { release, intent, client: withPackageObjectIdentity(walletClient, signal), getSellerAddress, signal }
        if (action === 'review') {
          const review = await readNativeSellerReview(input)
          if (active()) setView(previous => ({ ...previous, review }))
        } else if (view.review && canPrepare) {
          const prepared = await prepareNativeSellerOriginal({ ...input, reviewedIdentity: view.review.identity, gasCoinIds, gasBudget: budget })
          if (active()) setView(previous => ({ ...previous, record: prepared.record,
            status: prepared.prepared ? '原件已保存并通过模拟。' : '已读回现有原件，请先查询原摘要。' }))
        }
      } else if (record && action === 'query') {
        const client = walletClient && sameSeller ? withPackageObjectIdentity(walletClient, signal) : createNativePublicReadPaidOriginalClientV2(signal)
        const head = sameSeller ? await browserNativeSellerJournal(true).read(nativeSellerKey(nativeSellerScope(record.plan))) : null
        const observed = walletClient && head && typeof navigator.locks?.request === 'function'
          && publicMutationCanonical(head) === publicMutationCanonical(record)
          ? await reconcileNativeSellerOriginal({ record, client, signal })
          : { record, result: await queryNativeSellerOriginal(record, client, signal) }
        if (active()) setView(previous => ({ ...previous, ...observed }))
      } else if (record && walletClient && sameSeller && (action === 'discard' || action === 'execute' && canExecute && release)) {
        const options = { record, client: withPackageObjectIdentity(walletClient, signal), signal }
        const observed = action === 'discard'
          ? await reconcileNativeSellerOriginal({ ...options, cancelUnsigned: true })
          : await executeNativeSellerOriginal({ ...options, activeRelease: release!, getSellerAddress,
            sign: tx => wallet.signTransaction(tx, { retainReturnedSignature: true }) })
        if (active()) setView(previous => ({ ...previous, ...observed,
          status: observed.record.packet.phase === 'CANCELLED' ? '已保存本机取消，仍可查询原摘要。' : '' }))
      }
    } catch (error) {
      let saved = record
      if (action === 'prepare' || action === 'execute') {
        try { saved = await read() ?? record } catch { /* Keep the last readable original. */ }
      }
      if (active()) setView(previous => ({ ...previous, record: saved, error: error instanceof Error ? error.message : '卖方操作未完成。' }))
    } finally {
      lease.requests.delete(controller)
      lease.setRunning(false)
      if (active()) setView(previous => ({ ...previous, busy: false }))
    }
  }

  return <section className="space-y-4 p-6" aria-label="独立 Native Soul 挂牌与取消">
    <h1>独立 Native Soul 挂牌与取消</h1>
    <p className="break-all">Soul {soulId}</p>
    {!release && <p>此部署尚未获准执行独立 Native 挂牌和取消。</p>}
    {!seller && <p>连接卖方钱包可准备挂牌或取消。本机原件可直接查询。</p>}
    <label className="block">卖方操作 <select value={kind} disabled={busy} onChange={event => setKind(event.currentTarget.value === 'LIST' ? 'LIST' : 'CANCEL')}>
      <option value="LIST">挂牌</option><option value="CANCEL">取消挂牌</option>
    </select></label>
    <label className="block">卖方 Account <input value={account} disabled={busy} onChange={event => setAccount(event.currentTarget.value)} /></label>
    {kind === 'LIST' ? <>
      <label className="block">TransferPolicy ID <input value={policy} disabled={busy} onChange={event => setPolicy(event.currentTarget.value)} /></label>
      <label className="block">标价（最小单位） <input value={ask} disabled={busy} onChange={event => setAsk(event.currentTarget.value)} /></label>
      <label className="block">Collection ID（可选） <input value={collection} disabled={busy} onChange={event => setCollection(event.currentTarget.value)} /></label>
    </> : <label className="block">原 Offer ID <input value={offer} disabled={busy} onChange={event => setOffer(event.currentTarget.value)} /></label>}
    <button type="button" disabled={!seller || !release || !intent || busy} onClick={() => void run('review')}>{kind === 'LIST' ? '核对挂牌条件' : '核对取消条件'}</button>
    <button type="button" disabled={busy} onClick={() => void run('load')}>读取本机挂牌和取消原件</button>
    {view.review && <div className="space-y-2 break-all">
      <p>卖方 {view.review.seller} · Kiosk {view.review.kioskId}</p>
      {view.review.total && <p>当前买家总价 {view.review.total}（最小单位）</p>}
      <label className="block">SUI Gas Coin IDs <input value={gas} disabled={busy} onChange={event => setGas(event.currentTarget.value)} /></label>
      <label className="block">Gas 预算（MIST） <input value={budget} disabled={busy} onChange={event => setBudget(event.currentTarget.value)} /></label>
      <button type="button" disabled={!canPrepare || busy} onClick={() => void run('prepare')}>保留原件并模拟</button>
    </div>}
    {view.records.length > 1 && <ul>{view.records.map(item => <li key={item.packet.digest + ':' + item.packet.phase}>
      <button type="button" disabled={busy} onClick={() => setView(previous => ({ ...previous, record: item, result: null, status: '', error: '' }))}>
        {item.plan.intent.kind === 'LIST' ? '挂牌' : '取消挂牌'} {item.packet.digest} · {item.packet.phase}
      </button>
    </li>)}</ul>}
    {record && <article className="space-y-2 break-all" aria-label="本机 Native 卖方原件">
      <p>原摘要 {record.packet.digest} · 本机阶段 {phase}</p>
      <p>原卖方 {record.plan.intent.seller} · Account {record.plan.intent.accountId} · Kiosk {record.plan.kioskId}</p>
      <p>{record.plan.intent.kind === 'LIST' ? '原挂牌标价 ' + record.plan.intent.ask : '原取消 Offer ' + record.plan.intent.offerId}</p>
      <p>Gas 预算 {record.plan.gas.budget} MIST · {record.plan.gas.coins.map(coin => coin.objectId).join('、')}</p>
      <button type="button" disabled={busy} onClick={() => void run('query')}>查询原摘要</button>
      <button type="button" disabled={busy || !sameSeller || phase !== 'PREPARED'} onClick={() => void run('discard')}>取消本机未签名准备</button>
      <button type="button" disabled={busy || !canExecute} onClick={() => void run('execute')}>{phase === 'SIGNED' ? '复核并提交原签名' : '复核并签名原操作'}</button>
    </article>}
    {busy && <p role="status">正在核对或处理原操作…</p>}
    {view.status && <p role="status">{view.status}</p>}
    {result && (result.status === 'SUCCEEDED'
      ? <div role="status" className="break-all">
        <p>{result.kind === 'LIST' ? '已确认原挂牌' : '已确认原取消'} · Offer {result.offerId} · 检查点 {result.checkpoint}</p>
        {result.kind === 'LIST' && <>
          {result.reviewChanged && <p>链上挂牌条款与预览有变化，请在买入页重新核对该 Offer 和总价。</p>}
          <a href={buyRoute}>打开买入页核对这个 Offer</a>
        </>}
      </div>
      : <p role="status">{resultText[result.status]}</p>)}
    {view.error && <p role="alert">{view.error} 请先查原摘要再操作。</p>}
  </section>
}
