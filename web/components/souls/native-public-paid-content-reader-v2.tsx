'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { getBrowserContentSealConfig } from '@/lib/soulidity/browser-content-open'
import { parseCanonicalNativeWorkbenchTarget } from '@/lib/soulidity/canonical-native-workbench'
import { openNativePublicOwnerContentV2 } from '@/lib/soulidity/native-public-owner-content-open-v2'
import { openNativePublicPaidContentV2 } from '@/lib/soulidity/native-public-paid-content-open-v2'
import { parseNativePaidReviewEconomics } from '@/lib/soulidity/native-paid-review-config'
import { readContractCheckedNativePublicReadPaidPreviewV2 } from '@/lib/soulidity/commerce/native-public-read-paid-preview-v2'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { NativePublicReadPaidPreparedOriginalV2 } from '@/lib/soulidity/commerce/native-public-read-paid-preflight-v2'
import { openReusableNativePublicReadContentV2 } from '@/lib/soulidity/commerce/native-public-read-paid-delivery-v2'

type Preview = Awaited<ReturnType<typeof readContractCheckedNativePublicReadPaidPreviewV2>>
const emptyPreview = { busy: false, result: null as Preview | null, error: null as string | null }

function selectedEconomics(json: string | undefined, target: ReturnType<typeof parseCanonicalNativeWorkbenchTarget>) {
  if (!json) return undefined
  try { return parseNativePaidReviewEconomics(JSON.parse(json), target) }
  catch { return undefined }
}

/** Plaintext remains in this mounted view only. It is never put in query cache,
 * browser storage, recovery exports or logs. Legal prior copies cannot be revoked. */
export function NativePublicPaidContentReaderV2({ soulId, index, releaseJson, sourceKey, expectedOwnerSourceKey, ownerAddress, ownerRead = false, paidRead = true, paidPreview, paidRecovery }: {
  soulId: string; index: number; releaseJson: string; sourceKey: string; expectedOwnerSourceKey?: string; ownerAddress?: string; ownerRead?: boolean; paidRead?: boolean
  paidPreview?: { kind: number; scope: string; economicsJson?: string }
  paidRecovery?: { original: NativePublicReadPaidPreparedOriginalV2; client: SuiGrpcClient; kind: number; scope: string }
}) {
  const wallet = useWalletSign(), address = wallet.suiWallet?.address
  const reader = paidRecovery?.client ?? wallet.suiGrpcClient
  const clients = useMemo(() => [reader, wallet.suiGrpcClient], [reader, wallet.suiGrpcClient])
  const session = useCommittedSession(JSON.stringify([soulId, index, releaseJson, sourceKey, expectedOwnerSourceKey, ownerAddress, ownerRead, paidRead, paidPreview,
    paidRecovery?.original.packet.digest, paidRecovery?.kind, paidRecovery?.scope]), wallet.walletAccount ?? address, clients, wallet.currentWallet)
  const isOwner = ownerRead && address === ownerAddress
  const canRead = paidRecovery ? address === paidRecovery.original.intent.buyer : isOwner || paidRead && address !== ownerAddress
  const image = useRef<string | null>(null)
  const buffer = useRef<Uint8Array | null>(null), active = useRef<AbortController | null>(null)
  const previewActive = useRef<AbortController | null>(null)
  const [preview, setPreview] = useSessionState(session, emptyPreview)
  const [state, setState] = useSessionState(session, { busy: false, text: null as string | null, fileName: '', imageUrl: null as string | null, error: null as string | null })
  useLayoutEffect(() => () => { previewActive.current?.abort(); previewActive.current = null; active.current?.abort(); active.current = null; buffer.current?.fill(0); buffer.current = null; if (image.current) URL.revokeObjectURL(image.current); image.current = null }, [session])
  const close = () => { active.current?.abort(); active.current = null; buffer.current?.fill(0); buffer.current = null
    if (image.current) URL.revokeObjectURL(image.current); image.current = null
    setState({ busy: false, text: null, imageUrl: null, fileName: '', error: null }) }
  const open = async () => {
    const lease = session.capture()
    if (!canRead || !lease?.matches() || active.current || previewActive.current || !wallet.suiWallet || !wallet.suiGrpcClient) return
    const controller = new AbortController(); active.current = controller; lease.requests.add(controller)
    buffer.current?.fill(0); buffer.current = null; if (image.current) URL.revokeObjectURL(image.current); image.current = null; setState({ busy: true, text: null, imageUrl: null, fileName: '', error: null })
    let received: Uint8Array | null = null
    try {
      const client = paidRecovery?.client ?? withPackageObjectIdentity(wallet.suiGrpcClient, controller.signal)
      const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson)), viewerAddress = wallet.suiWallet.address
      const protectedOptions = {
        sealClient: wallet.suiGrpcClient,
        blobBaseUrl: (process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.mainnet.walrus.mirai.cloud').replace(/\/$/, ''),
        sealConfig: getBrowserContentSealConfig(), getAddress: wallet.getWalletAddress, signPersonalMessage: wallet.signPersonalMessage,
      }
      const selected = { ...protectedOptions, client, target, soulId, recordIndex: index, viewerAddress, signal: controller.signal }
      let result: Awaited<ReturnType<typeof openNativePublicPaidContentV2>>
      if (paidRecovery) {
        const { recoverNativePublicReadPaidContentV2 } = await import('@/lib/soulidity/commerce/native-public-read-paid-recovery-delivery-v2')
        controller.signal.throwIfAborted()
        const { original, kind, scope } = paidRecovery
        const delivery = await recoverNativePublicReadPaidContentV2({
          history: { ...original.context.originalReceiptContext, intent: original.intent, packet: original.packet,
            gas: original.reviewedGas, client, signal: controller.signal },
          delivery: { qualification: { format: 'native-public-read-v2', client, target, soulId, buyer: viewerAddress,
            recordIndex: index, kind, requiredScope: BigInt(scope), expectedSourceKey: expectedOwnerSourceKey, signal: controller.signal },
            protected: protectedOptions },
        })
        if (delivery.status !== 'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED' || delivery.delivery.status !== 'CONTENT_OPENED') {
          throw Error(delivery.status === 'ORIGINAL_SUBSCRIPTION_NOT_CONFIRMED'
            ? '本次未能确认原订阅结果。请保留原文件并查询原交易。'
            : '当前钱包已无可复用的读取资格。原付款记录仍可查询。')
        }
        result = delivery.delivery.content
      } else if (isOwner) result = await openNativePublicOwnerContentV2({ ...selected, expectedOwnerSourceKey })
      else if (paidPreview) {
        const delivery = await openReusableNativePublicReadContentV2({
          qualification: { format: 'native-public-read-v2', client, target, soulId, buyer: viewerAddress, recordIndex: index,
            kind: paidPreview.kind, requiredScope: BigInt(paidPreview.scope), expectedSourceKey: expectedOwnerSourceKey, signal: controller.signal },
          protected: protectedOptions,
        })
        if (delivery.status !== 'CONTENT_OPENED') throw Error('当前资格无法复用，请先核对当前资格与总价。')
        result = delivery.content
      } else result = await openNativePublicPaidContentV2({ ...selected, expectedSourceKey: expectedOwnerSourceKey })
      received = result.bytes
      if (!lease.matches() || controller.signal.aborted || active.current !== controller) { result.bytes.fill(0); return }
      buffer.current = result.bytes
      const text = /^(text\/(plain|markdown)|application\/json)(;|$)/.test(result.mimeType) && result.bytes.length <= 1024 * 1024
        ? new TextDecoder('utf-8', { fatal: true }).decode(result.bytes) : 'Verified content is not supported by this inline viewer.'
      const imageUrl = /^image\/(png|jpeg|gif|webp)$/.test(result.mimeType) && result.bytes.length <= 20 * 1024 * 1024
        ? URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mimeType })) : null
      image.current = imageUrl
      setState({ busy: false, text: imageUrl ? null : text, imageUrl, fileName: result.fileName, error: null })
    } catch (error) {
      if (received && buffer.current === received) { received.fill(0); buffer.current = null }
      if (active.current === controller && lease.matches() && !controller.signal.aborted) setState({ busy: false, text: null, imageUrl: null, fileName: '', error:
        error instanceof Error && error.message.endsWith('_OVERVIEW_CHANGED_REFRESH') ? 'This Soul changed since the library was loaded. Refresh the content library before reading.'
          : error instanceof Error ? error.message : 'Content could not be opened.' })
    } finally { lease.requests.delete(controller); if (active.current === controller) active.current = null }
  }
  async function checkAccessAndQuote() {
    const lease = session.capture(), source = wallet.suiGrpcClient
    if (!paidRead || !paidPreview || !address || !source || wallet.getWalletAddress() !== address
      || !lease?.matches() || active.current || previewActive.current) return
    const request = new AbortController()
    previewActive.current = request
    lease.requests.add(request)
    setPreview({ ...emptyPreview, busy: true })
    const valid = () => lease.matches() && !request.signal.aborted && previewActive.current === request
    try {
      const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
      const result = await readContractCheckedNativePublicReadPaidPreviewV2({
        format: 'native-public-read-v2', client: withPackageObjectIdentity(source, request.signal), target,
        economics: selectedEconomics(paidPreview.economicsJson, target), expectedSourceKey: expectedOwnerSourceKey,
        soulId, buyer: address, kind: paidPreview.kind, recordIndex: index, requiredScope: BigInt(paidPreview.scope), signal: request.signal,
      })
      if (valid()) setPreview(wallet.getWalletAddress() === address ? { ...emptyPreview, result } : emptyPreview)
    } catch (error) {
      if (valid()) setPreview({ ...emptyPreview, error: error instanceof Error && error.message.endsWith('_OVERVIEW_CHANGED_REFRESH')
        ? '内容库已变化，请刷新后重新核对。'
        : error instanceof Error ? error.message : '资格与报价暂不可查询。' })
    } finally {
      lease.requests.delete(request)
      if (previewActive.current === request) previewActive.current = null
    }
  }

  const qualification = preview.result?.qualification
  const action = qualification?.decision.action
  const quote = preview.result?.status === 'CONTRACT_QUOTE_CHECKED' && qualification?.quote
    ? { ...qualification.quote, total: preview.result.contractQuote.contractQuote.total } : null
  return <div className="space-y-2 pt-2">
    {paidPreview && paidRead && <section aria-label="内容资格与报价" className="space-y-2">
      <Button variant="outline" disabled={!address || preview.busy || state.busy} onClick={() => void checkAccessAndQuote()}>核对当前资格与总价</Button>
      {preview.busy && <p role="status">正在核对当前资格…</p>}
      {preview.error && <p role="alert">{preview.error}</p>}
      {action === 'REUSE_ENTRY' && <p role="status">现有同类订阅覆盖此版本的范围，可直接打开内容。</p>}
      {action === 'REUSE_OWNER' && <p role="status">此版本允许持有人读取，可用持有人钱包打开内容。</p>}
      {qualification?.decision.action === 'BLOCKED' && <p role="status">此版本暂无可用购买或复用资格（{qualification.decision.reason}）。</p>}
      {preview.result?.status === 'QUOTE_UNAVAILABLE' && <p role="status">当前缺少有效费用配置，暂无法核对完整总价。</p>}
      {quote && qualification && <div className="break-all">
        <p>合约核对总价（最小单位）{quote.total}</p>
        <p>内容发行方收款 {quote.ask} · 平台费 {quote.platformFee}</p>
        <p>币种 {qualification.coinType}。SUI Gas 在交易审阅时另算。</p>
        {qualification.purchaseBlockers.length > 0 && <p role="status">当前购买受限（{qualification.purchaseBlockers.join('、')}）。</p>}
      </div>}
    </section>}
    {paidRecovery && !canRead && <p role="status">请连接原买家钱包读取所选版本。</p>}
    <Button variant="outline" disabled={state.busy || preview.busy || !wallet.suiWallet || !wallet.suiGrpcClient || !canRead} onClick={() => void open()}>{state.busy ? 'Opening protected content…' : paidRecovery ? '用原买家钱包打开内容' : 'Read protected content'}</Button>
    <p className="text-xs text-muted">Requests a wallet message for reading. No transaction or payment is submitted.</p>
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {(state.text !== null || state.imageUrl) && <section aria-label={`Opened content ${state.fileName}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><span>{state.fileName}</span><Button variant="outline" onClick={close}>Close content</Button></div>
      {state.imageUrl && <img src={state.imageUrl} alt={state.fileName} className="max-h-[32rem] max-w-full object-contain" />}
      {state.text !== null && <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card2 p-3 text-sm">{state.text}</pre>}
    </section>}
  </div>
}
