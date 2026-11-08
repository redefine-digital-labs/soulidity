'use client'
import { useLayoutEffect, useRef } from 'react'
import { useWalletSign } from '../../lib/hooks/use-wallet-sign'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { withPackageObjectIdentity } from '../../lib/sui/package-object-client'
import { getBrowserContentSealConfig } from '../../lib/soulidity/browser-content-open'
import { parseCanonicalNativeWorkbenchTarget } from '../../lib/soulidity/canonical-native-workbench'
import { openNativePublicGrantContentV2 } from '../../lib/soulidity/native-public-grant-content-open-v2'

/** Grant policy only. Public read-mask eligibility is not a Grant. The existing
 * opener checks the actual issuer/generation/scope/expiry and executes Seal's
 * current policy before returning bytes. Plaintext stays in this view. */
export function ManagementNativeGrantReaderV1(props: { soulId: string; index: number; releaseJson: string; sourceKey: string }) {
  const wallet = useWalletSign(), session = useCommittedSession(JSON.stringify([props.soulId, props.index, props.releaseJson, props.sourceKey]), wallet.suiWallet?.address, wallet.suiGrpcClient, wallet.signPersonalMessage)
  const active = useRef<AbortController | null>(null), serial = useRef(0)
  const bytes = useRef<Uint8Array | null>(null), image = useRef<string | null>(null)
  type View = { busy?: boolean; cancelled?: boolean; error?: string; text?: string; imageUrl?: string; name?: string }
  const [view, setView] = useSessionState<View>(session, {})
  function clearResources() { bytes.current?.fill(0); bytes.current = null; if (image.current) URL.revokeObjectURL(image.current); image.current = null }
  function retire() { serial.current++; active.current?.abort(); active.current = null; clearResources() }
  useLayoutEffect(() => () => retire(), [session])
  function close() {
    const lease = session.capture(); if (!lease?.matches()) return
    retire(); const operation = serial.current
    setView(previous => lease.matches() && session.capture() === lease && serial.current === operation ? { cancelled: true } : previous)
  }
  async function open() {
    const lease = session.capture(), address = wallet.suiWallet?.address, client = wallet.suiGrpcClient
    if (!lease?.matches() || !address || !client) return
    retire(); const operation = serial.current, controller = new AbortController()
    active.current = controller; lease.requests.add(controller)
    const valid = () => lease.matches() && session.capture() === lease && serial.current === operation && active.current === controller && !controller.signal.aborted
    const publish = (next: View) => setView(previous => valid() ? next : previous)
    const getAddress = wallet.getWalletAddress, signPersonalMessage = wallet.signPersonalMessage
    publish({ busy: true })
    let received: Uint8Array | null = null
    try {
      const result = await openNativePublicGrantContentV2({ client: withPackageObjectIdentity(client, controller.signal), sealClient: client,
        target: parseCanonicalNativeWorkbenchTarget(JSON.parse(props.releaseJson)), soulId: props.soulId, recordIndex: props.index, viewerAddress: address,
        blobBaseUrl: (process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.mainnet.walrus.mirai.cloud').replace(/\/$/, ''),
        sealConfig: getBrowserContentSealConfig(), signal: controller.signal, getAddress, signPersonalMessage })
      received = result.bytes
      if (!valid()) { received.fill(0); return }
      bytes.current = received
      const text = /^(text\/(plain|markdown)|application\/json)(;|$)/.test(result.mimeType) && received.length <= 1024 * 1024
        ? new TextDecoder('utf-8', { fatal: true }).decode(received) : 'Verified content is not supported by this inline viewer.'
      const imageUrl = /^image\/(png|jpeg|gif|webp)$/.test(result.mimeType) && received.length <= 20 * 1024 * 1024
        ? URL.createObjectURL(new Blob([new Uint8Array(received)], { type: result.mimeType })) : undefined
      image.current = imageUrl ?? null
      publish({ text: imageUrl ? undefined : text, imageUrl, name: result.fileName })
    } catch (error) {
      if (received) { received.fill(0); if (bytes.current === received) clearResources() }
      publish({ error: error instanceof Error ? error.message : 'Current grant could not be verified. Retry with the authorized wallet.' })
    } finally { lease.requests.delete(controller) }
  }
  return <section aria-label={`Granted content record ${props.index}`} className="space-y-2 pt-2">
    <button type="button" disabled={view.busy || !wallet.suiWallet || !wallet.suiGrpcClient} onClick={() => void open()}>Read with current grant</button>
    <p>A wallet message verifies your current grant. No transaction or payment is submitted. Reading fails if its issuer, scope, generation or expiry is no longer valid.</p>
    {view.busy && <><p role="status">Checking current grant and opening protected content…</p><button type="button" onClick={close}>Cancel grant read</button></>}
    {view.cancelled && <p role="status">Granted content closed. Read again to check current permission.</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {(view.text !== undefined || view.imageUrl) && <section aria-label={`Opened granted content ${view.name}`}>
      <span>{view.name}</span><button type="button" onClick={close}>Close granted content</button>
      {view.imageUrl && <img src={view.imageUrl} alt={view.name} className="max-h-[32rem] max-w-full object-contain" />}
      {view.text !== undefined && <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words">{view.text}</pre>}
    </section>}
    <p>Previously copied plaintext cannot be remotely recalled.</p>
  </section>
}
