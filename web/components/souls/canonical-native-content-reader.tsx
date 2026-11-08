'use client'

import { useLayoutEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { getBrowserContentSealConfig } from '@/lib/soulidity/browser-content-open'
import { parseCanonicalNativeWorkbenchTarget } from '@/lib/soulidity/canonical-native-workbench'
import { openCanonicalNativeContent } from '@/lib/soulidity/canonical-native-content-open'

/** Plaintext remains in this mounted view only. It is never put in query cache,
 * browser storage, recovery exports or logs. Legal prior copies cannot be revoked. */
export function CanonicalNativeContentReader({ soulId, index, releaseJson, sourceKey, requiredViewerAddress, expectedRecord }: {
  soulId: string; index: number; releaseJson: string; sourceKey: string; requiredViewerAddress?: string
  expectedRecord?: { version: string; ciphertextHash: string }
}) {
  const wallet = useWalletSign()
  const session = useCommittedSession(JSON.stringify([sourceKey, requiredViewerAddress, expectedRecord]), wallet.walletAccount ?? wallet.suiWallet?.address, wallet.suiGrpcClient, wallet.currentWallet)
  const viewer = wallet.suiWallet?.address
  const canRead = Boolean(viewer && (!requiredViewerAddress || viewer === requiredViewerAddress))
  const buffer = useRef<Uint8Array | null>(null), active = useRef<AbortController | null>(null)
  const [state, setState] = useSessionState(session, { busy: false, text: null as string | null, fileName: '', error: null as string | null })
  useLayoutEffect(() => () => {
    active.current?.abort(); active.current = null; buffer.current?.fill(0); buffer.current = null
  }, [session])
  const close = () => { active.current?.abort(); active.current = null; buffer.current?.fill(0); buffer.current = null
    setState({ busy: false, text: null, fileName: '', error: null }) }
  const open = async () => {
    const lease = session.capture()
    if (!lease?.matches() || active.current || !viewer || !canRead || !wallet.suiGrpcClient || wallet.getWalletAddress() !== viewer) return
    const controller = new AbortController(); active.current = controller; lease.requests.add(controller)
    buffer.current?.fill(0); buffer.current = null; setState({ busy: true, text: null, fileName: '', error: null })
    try {
      const result = await openCanonicalNativeContent({ client: withPackageObjectIdentity(wallet.suiGrpcClient, controller.signal),
        sealClient: wallet.suiGrpcClient, target: parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson)), soulId, recordIndex: index,
        viewerAddress: viewer, expectedRecord, blobBaseUrl: (process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.mainnet.walrus.mirai.cloud').replace(/\/$/, ''),
        sealConfig: getBrowserContentSealConfig(), signal: controller.signal, getAddress: wallet.getWalletAddress, signPersonalMessage: wallet.signPersonalMessage })
      if (!lease.matches() || controller.signal.aborted || wallet.getWalletAddress() !== viewer) { result.bytes.fill(0); return }
      buffer.current = result.bytes
      const text = /^(text\/(plain|markdown)|application\/json)(;|$)/.test(result.mimeType) && result.bytes.length <= 1024 * 1024
        ? new TextDecoder('utf-8', { fatal: true }).decode(result.bytes) : 'Verified content is not supported by this inline viewer.'
      setState({ busy: false, text, fileName: result.fileName, error: null })
    } catch (error) {
      if (active.current === controller && lease.matches() && !controller.signal.aborted) {
        buffer.current?.fill(0); buffer.current = null
        setState({ busy: false, text: null, fileName: '', error: error instanceof Error ? error.message : 'Content could not be opened.' })
      }
    } finally { lease.requests.delete(controller); if (active.current === controller) active.current = null }
  }
  return <div className="space-y-2 pt-2">
    <Button variant="outline" disabled={state.busy || !canRead} onClick={() => void open()}>{state.busy ? 'Opening protected content…' : 'Read protected content'}</Button>
    <p className="text-xs text-muted">Requests a wallet message for reading. No transaction or payment is submitted.</p>
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state.text !== null && <section aria-label={`Opened content ${state.fileName}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><span>{state.fileName}</span><Button variant="outline" onClick={close}>Close content</Button></div>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card2 p-3 text-sm">{state.text}</pre>
    </section>}
  </div>
}
