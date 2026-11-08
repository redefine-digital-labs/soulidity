'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { getBrowserContentSealConfig } from '@/lib/soulidity/browser-content-open'
import { parseCanonicalNativeWorkbenchTarget } from '@/lib/soulidity/canonical-native-workbench'
import { openCanonicalNativeContent } from '@/lib/soulidity/canonical-native-content-open'
import { presentVerifiedContent, type ProtectedContentPresentation } from './protected-content-presentation'

const emptyContent = { busy: false, text: null as string | null, fileName: '',
  attachment: null as ProtectedContentPresentation['attachment'], error: null as string | null }

/** Plaintext stays in this mounted view until the user explicitly downloads a
 * file. The reader does not cache or include plaintext in recovery exports. */
export function CanonicalNativeContentReader({ soulId, index, releaseJson, sourceKey, requiredViewerAddress, expectedRecord }: {
  soulId: string; index: number; releaseJson: string; sourceKey: string; requiredViewerAddress?: string
  expectedRecord?: { version: string; ciphertextHash: string }
}) {
  const wallet = useWalletSign()
  const session = useCommittedSession(JSON.stringify([sourceKey, requiredViewerAddress, expectedRecord]), wallet.walletAccount ?? wallet.suiWallet?.address, wallet.suiGrpcClient, wallet.currentWallet)
  const viewer = wallet.suiWallet?.address
  const canRead = Boolean(viewer && (!requiredViewerAddress || viewer === requiredViewerAddress))
  const buffer = useRef<Uint8Array | null>(null), active = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)
  const [state, setState] = useSessionState(session, emptyContent)
  const clearContent = useCallback(() => {
    buffer.current?.fill(0)
    buffer.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }, [])
  useLayoutEffect(() => () => {
    active.current?.abort()
    active.current = null
    clearContent()
  }, [session, clearContent])
  const close = () => {
    active.current?.abort()
    active.current = null
    clearContent()
    setState(emptyContent)
  }
  const open = async () => {
    const lease = session.capture()
    if (!lease?.matches() || active.current || !viewer || !canRead || !wallet.suiGrpcClient || wallet.getWalletAddress() !== viewer) return
    const controller = new AbortController(); active.current = controller; lease.requests.add(controller)
    clearContent()
    setState({ ...emptyContent, busy: true })
    try {
      const result = await openCanonicalNativeContent({ client: withPackageObjectIdentity(wallet.suiGrpcClient, controller.signal),
        sealClient: wallet.suiGrpcClient, target: parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson)), soulId, recordIndex: index,
        viewerAddress: viewer, expectedRecord, blobBaseUrl: (process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.mainnet.walrus.mirai.cloud').replace(/\/$/, ''),
        sealConfig: getBrowserContentSealConfig(), signal: controller.signal, getAddress: wallet.getWalletAddress, signPersonalMessage: wallet.signPersonalMessage })
      if (!lease.matches() || controller.signal.aborted || wallet.getWalletAddress() !== viewer) { result.bytes.fill(0); return }
      buffer.current = result.bytes
      const presentation = presentVerifiedContent(result)
      objectUrl.current = presentation.attachment?.url ?? null
      setState({ ...emptyContent, ...presentation, fileName: result.fileName })
    } catch (error) {
      if (active.current === controller && lease.matches() && !controller.signal.aborted) {
        clearContent()
        setState({ ...emptyContent, error: error instanceof Error ? error.message : 'Content could not be opened.' })
      }
    } finally { lease.requests.delete(controller); if (active.current === controller) active.current = null }
  }
  return <div className="space-y-2 pt-2">
    <Button variant="outline" disabled={state.busy || !canRead} onClick={() => void open()}>{state.busy ? 'Opening protected content…' : 'Read protected content'}</Button>
    <p className="text-xs text-muted">Requests a wallet message for reading. No transaction or payment is submitted.</p>
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {(state.text !== null || state.attachment) && <section aria-label={`Opened content ${state.fileName}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><span>{state.fileName}</span><Button variant="outline" onClick={close}>Close content</Button></div>
      {state.attachment?.kind === 'download' && <a className="text-accent underline" href={state.attachment.url} download={state.fileName}>Download verified file</a>}
      {state.text !== null && <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card2 p-3 text-sm">{state.text}</pre>}
    </section>}
  </div>
}
