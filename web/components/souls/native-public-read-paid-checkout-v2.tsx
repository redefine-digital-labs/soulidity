'use client'

import { useMemo } from 'react'
import { normalizeStructTag } from '@mysten/sui/utils'
import { Button } from '@/components/ui/button'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import type { NativePaidCheckoutInstallationV2 } from '@/lib/soulidity/native-public-read-paid-checkout-config-v2'
import { reviewNativePublicReadPaidInputsV2 } from '@/lib/soulidity/commerce/native-public-read-paid-input-provider-v2'
import { readCommerceOwnedCoinInventory } from '@/lib/soulidity/commerce/owned-coin-inventory'
import { NativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseSelectionV2 } from './native-public-read-paid-purchase-v2'

const SUI = normalizeStructTag('0x2::sui::SUI')
const MAX_U64 = (1n << 64n) - 1n
const QUOTE_WINDOW_MS = 300_000n
const MAX_GAS_COINS = 256
type Inventory = Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>>
type Review = Extract<Awaited<ReturnType<typeof reviewNativePublicReadPaidInputsV2>>, { status: 'PURCHASE_SELECTION_REQUIRED' }>
type Qualification = NativePublicReadPaidPurchaseSelectionV2['input']['qualification']

interface CheckoutProps {
  soulId: string
  index: number
  kind: number
  contentScope: string
  releaseJson: string
  sourceKey: string
  expectedSourceKey: string
  installation: NativePaidCheckoutInstallationV2
}
interface CheckoutQuote {
  qualification: Qualification
  review: Review
  paymentCoins: Inventory['coins']
  gasCoins: Inventory['coins']
  price: string
  expirationEpoch: string
  quoteExpiryMs: string
}
type ReviewState =
  | { status: 'idle' | 'loading' | 'reuse' | 'blocked' | 'failed' }
  | { status: 'ready'; quote: CheckoutQuote }

const emptyFunding = { paymentId: '', gasIds: [] as string[], budget: '' }

export function NativePublicReadPaidCheckoutV2({
  soulId, index, kind, contentScope, releaseJson, sourceKey, expectedSourceKey, installation,
}: CheckoutProps) {
  const wallet = useWalletSign()
  const buyer = wallet.suiWallet?.address ?? null
  const client = wallet.suiGrpcClient
  const authority = useMemo(() => ({ wallet: wallet.currentWallet, installation }), [wallet.currentWallet, installation])
  const session = useCommittedSession(
    JSON.stringify([sourceKey, expectedSourceKey, installation.activationKey, buyer]),
    wallet.walletAccount ?? buyer, client, authority,
  )
  const [state, setState] = useSessionState<ReviewState>(session, { status: 'idle' })
  const [funding, setFunding] = useSessionState(session, emptyFunding)
  const [selection, setSelection] = useSessionState<NativePublicReadPaidPurchaseSelectionV2 | null>(session, null)
  const { execution, target, economics, activationKey } = installation
  const ready = buyer && client && execution.isCurrent()

  async function reviewPurchase() {
    const lease = session.capture()
    if (!lease || lease.isRunning() || !buyer || !client || !execution.isCurrent() || wallet.getWalletAddress() !== buyer) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
    const getBuyerAddress = () => lease.matches() && !signal.aborted && execution.isCurrent() ? wallet.getWalletAddress() : null
    const qualification: Qualification = {
      format: 'native-public-read-v2', target, economics, soulId, buyer,
      recordIndex: index, kind, requiredScope: BigInt(contentScope), expectedSourceKey,
    }
    lease.setRunning(true)
    lease.requests.add(controller)
    setSelection(null)
    setFunding(emptyFunding)
    setState({ status: 'loading' })
    try {
      const reader = withPackageObjectIdentity(client, signal)
      const review = await reviewNativePublicReadPaidInputsV2({
        qualification: { ...qualification, client: reader, signal }, purchase: null, getBuyerAddress,
      })
      if (getBuyerAddress() !== buyer) throw Error('CHECKOUT_SESSION_CHANGED')
      if (review.status === 'REUSE_CURRENT_ACCESS' || review.status === 'PURCHASE_BLOCKED') {
        setState({ status: review.status === 'REUSE_CURRENT_ACCESS' ? 'reuse' : 'blocked' })
        return
      }
      if (review.status !== 'PURCHASE_SELECTION_REQUIRED') throw Error('CHECKOUT_QUOTE_UNAVAILABLE')

      const inventory = (coinType: string) => readCommerceOwnedCoinInventory({ client: reader, owner: buyer, coinType, getViewerAddress: getBuyerAddress, signal })
      const paymentInventory = inventory(review.settlementPreview.coinType)
      const gasInventory = normalizeStructTag(review.settlementPreview.coinType) === SUI ? paymentInventory : inventory(SUI)
      const [payment, gas, epochResponse] = await Promise.all([
        paymentInventory, gasInventory, reader.ledgerService.getEpoch({ readMask: { paths: ['epoch', 'reference_gas_price'] } }, { abort: signal }),
      ])
      const epoch = epochResponse.response.epoch
      const quoteExpiry = BigInt(review.reviewed.observedAtMs) + QUOTE_WINDOW_MS
      if (getBuyerAddress() !== buyer || typeof epoch?.epoch !== 'bigint' || epoch.epoch < 0n || epoch.epoch >= MAX_U64
        || typeof epoch.referenceGasPrice !== 'bigint' || epoch.referenceGasPrice <= 0n || epoch.referenceGasPrice > MAX_U64
        || quoteExpiry > MAX_U64) throw Error('CHECKOUT_GAS_WINDOW')
      setState({ status: 'ready', quote: {
        qualification, review, paymentCoins: payment.coins.filter(coin => BigInt(coin.balance) >= BigInt(review.settlementPreview.total)),
        gasCoins: gas.coins.filter(coin => BigInt(coin.balance) > 0n), price: String(epoch.referenceGasPrice),
        expirationEpoch: String(epoch.epoch + 1n), quoteExpiryMs: String(quoteExpiry),
      } })
    } catch {
      if (lease.matches()) setState({ status: 'failed' })
    } finally {
      controller.abort()
      lease.requests.delete(controller)
      lease.setRunning(false)
    }
  }

  const quote = state.status === 'ready' ? state.quote : null
  const payment = quote?.paymentCoins.find(coin => coin.objectId === funding.paymentId)
  const availableGas = quote?.gasCoins.filter(coin => coin.objectId !== funding.paymentId) ?? []
  const selectedGas = availableGas.filter(coin => funding.gasIds.includes(coin.objectId))
  const gasBalance = selectedGas.reduce((balance, coin) => balance + BigInt(coin.balance), 0n)
  const budget = /^[1-9][0-9]{0,19}$/.test(funding.budget) ? BigInt(funding.budget) : 0n
  const sufficientGas = selectedGas.length <= MAX_GAS_COINS && budget > 0n && budget <= MAX_U64 && budget <= gasBalance

  function confirmFunding() {
    if (!quote || !payment || !sufficientGas || selection || !session.matches()
      || !execution.isCurrent() || wallet.getWalletAddress() !== quote.qualification.buyer) return
    const { balance: _paymentBalance, ...paymentCoin } = payment
    const gasCoins = selectedGas.map(({ objectId, version, digest }) => ({ objectId, version, digest }))
    setSelection({
      sourceKey, activationKey, disabledReason: null, execution,
      input: {
        qualification: quote.qualification, reviewed: quote.review.reviewed, paymentCoin,
        gas: { coins: gasCoins, budget: funding.budget, price: quote.price },
        expirationEpoch: quote.expirationEpoch, quoteExpiryMs: quote.quoteExpiryMs,
        attempt: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      },
    })
  }

  if (!ready) return <p>{buyer ? '此发布的内容购买暂不可用。' : '连接钱包以核对购买条件。'}</p>
  return <section aria-label="内容购买付款选项" className="space-y-3">
    <Button variant="outline" type="button" disabled={state.status === 'loading'}
      onClick={() => void reviewPurchase()}>{state.status === 'idle' ? '核对内容总价和付款选项' : '重新核对付款选项'}</Button>
    {state.status === 'loading' && <p role="status">正在核对内容资格、总价和钱包 Coin…</p>}
    {state.status === 'reuse' && <p role="status">已有内容资格，请直接读取当前版本。</p>}
    {state.status === 'blocked' && <p role="status">当前版本的购买条件尚未满足。请刷新内容库。</p>}
    {state.status === 'failed' && <p role="alert">付款选项核对失败。请确认钱包和网络，再重新核对。</p>}
    {quote && <>
      <p className="break-all">总价 {quote.review.settlementPreview.total}（最小单位） · {quote.review.settlementPreview.coinType}</p>
      <p>直接收入 {quote.review.settlementPreview.directPayout.amount} · 协议费用 {quote.review.settlementPreview.protocolIncome.amount}</p>
      <p>SUI Gas 单价 {quote.price} MIST · 交易有效至 epoch {quote.expirationEpoch} · 报价有效期 5 分钟</p>
      {quote.paymentCoins.length === 0 && <p role="status">钱包中没有足额的付款 Coin。</p>}
      <fieldset disabled={selection !== null} className="space-y-2">
        <label className="block">付款 Coin
          <select className="block w-full rounded border bg-background p-1" value={funding.paymentId} onChange={event => {
            const paymentId = event.target.value
            setFunding(current => ({ ...current, paymentId, gasIds: current.gasIds.filter(id => id !== paymentId) }))
          }}>
            <option value="">选择付款 Coin</option>
            {quote.paymentCoins.map(coin => <option key={coin.objectId} value={coin.objectId}>{coin.balance} · {coin.objectId}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend>SUI Gas Coin</legend>
          {availableGas.length === 0 && <p>钱包中没有可单独用于 Gas 的 SUI Coin。</p>}
          <div className="max-h-40 overflow-auto">
            {availableGas.map(coin => <label key={coin.objectId} className="block break-all">
              <input type="checkbox" checked={funding.gasIds.includes(coin.objectId)}
                disabled={funding.gasIds.length >= MAX_GAS_COINS && !funding.gasIds.includes(coin.objectId)}
                onChange={event => {
                  const checked = event.target.checked
                  setFunding(current => ({ ...current, gasIds: checked
                    ? [...current.gasIds, coin.objectId]
                    : current.gasIds.filter(id => id !== coin.objectId) }))
                }}/>
              {' '}{coin.balance} MIST · {coin.objectId}
            </label>)}
          </div>
          <p>已选 Gas 余额 {String(gasBalance)} MIST</p>
        </fieldset>
        <label className="block">Gas 预算（MIST）
          <input className="block rounded border bg-background p-1" inputMode="numeric" maxLength={20}
            value={funding.budget} onChange={event => {
              const value = event.target.value
              setFunding(current => ({ ...current, budget: value }))
            }}/>
        </label>
        <Button type="button" disabled={!payment || !sufficientGas} onClick={confirmFunding}>确认所选付款 Coin 和 Gas</Button>
      </fieldset>
      {selection && <NativePublicReadPaidPurchaseV2 {...{ soulId, index, kind, contentScope, releaseJson, sourceKey, selection }}/>}
    </>}
  </section>
}
