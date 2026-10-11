'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSuiClient } from '@mysten/dapp-kit'
import type { SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Button } from '@/components/ui/button'
import { completeReadStep, decryptNativeCompleteArtwork } from '@/lib/animacraft/native-complete-read-client'
import { getBrowserNativeProtectedArtworkConfig, readBrowserNativeCompleteReadTarget } from '@/lib/animacraft/browser-native-artwork'

/** An explicit wallet read, never an equipment transaction or a server decrypt. */
export function NativeProtectedArtwork({ soulObjectId, stateObjectId }: { soulObjectId: string; stateObjectId: string }) {
  const account = useCurrentAccount(); const client = useSuiClient()
  const { currentWallet: wallet } = useCurrentWallet()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  let config: ReturnType<typeof getBrowserNativeProtectedArtworkConfig> | null = null; let configError = ''
  try { config = getBrowserNativeProtectedArtworkConfig() } catch (error) { configError = error instanceof Error ? error.message : 'Protected artwork release unavailable.' }
  const address = account?.address ?? null
  const scope = JSON.stringify([soulObjectId, stateObjectId, address, config, configError])
  const live = useRef({ scope, address, client, wallet })
  useLayoutEffect(() => { live.current = { scope, address, client, wallet } }, [scope, address, client, wallet])
  const currentAttempt = useRef<AbortController | null>(null)
  const currentUrl = useRef<string | null>(null)
  const [view, setView] = useState<{ scope: string; client: typeof client; wallet: typeof wallet; busy: boolean; phase?: string; error?: string; url?: string } | null>(null)
  const visible = view?.scope === scope && view.client === client && view.wallet === wallet ? view : null
  const [previousIdentity, setPreviousIdentity] = useState({ scope, client, wallet })
  if (previousIdentity.scope !== scope || previousIdentity.client !== client || previousIdentity.wallet !== wallet) {
    setPreviousIdentity({ scope, client, wallet }); setView(null)
  }
  useLayoutEffect(() => {
    return () => {
      currentAttempt.current?.abort(); currentAttempt.current = null
      if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); currentUrl.current = null }
    }
  }, [scope, client, wallet])

  async function open() {
    if (!account || !address || !wallet || currentAttempt.current) return
    const controller = new AbortController(); currentAttempt.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
    const matches = () => live.current.scope === scope && live.current.client === client && live.current.wallet === wallet
      && currentAttempt.current === controller && !controller.signal.aborted
    if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); currentUrl.current = null }
    setView({ scope, client, wallet, busy: true, phase: 'verifying' })
    try {
      if (!config) throw new Error(configError)
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('Current wallet chain reader is unavailable. Please reconnect.')
      const blob = await completeReadStep(signal, () => decryptNativeCompleteArtwork({
        soulId: soulObjectId, owner: address, client: client as unknown as SealCompatibleClient, signal,
        getAddress: () => matches() ? live.current.address : null,
        signPersonalMessage: async message => {
          signal.throwIfAborted()
          if (!matches()) throw new Error('Artwork wallet session changed.')
          return (await signPersonalMessage({ message, account })).signature
        },
        read: () => readBrowserNativeCompleteReadTarget({ soulId: soulObjectId, stateId: stateObjectId,
          config, signal }, { client: () => grpc }),
        onPhase: phase => { if (matches()) setView({ scope, client, wallet, busy: true, phase }) },
      }))
      signal.throwIfAborted()
      if (matches()) {
        const url = URL.createObjectURL(blob); currentUrl.current = url
        setView({ scope, client, wallet, busy: false, url })
      }
    } catch (error) {
      if (matches()) setView({ scope, client, wallet, busy: false, error: signal.aborted
        ? 'Protected artwork access timed out. Please retry.'
        : error instanceof Error ? error.message : 'Unable to open the protected artwork. Please retry.' })
    } finally { if (currentAttempt.current === controller) currentAttempt.current = null }
  }
  function cancel() {
    currentAttempt.current?.abort(); currentAttempt.current = null
    setView({ scope, client, wallet, busy: false, error: 'Read cancelled. A wallet prompt may still be open; dismiss it before retrying.' })
  }
  return <div className="mt-3" aria-label="Protected original artwork">
    <p className="text-xs text-muted">Open the saved completion image with the current owner’s wallet. This requests temporary read access, not a purchase or equipment transaction.</p>
    {(!address || !wallet) && <p className="mt-2 text-sm text-muted">Connect the current owner’s wallet to continue.</p>}
    <Button className="mt-2" disabled={!address || !wallet || visible?.busy} onClick={() => void open()}>
      {visible?.error ? 'Retry protected artwork' : 'Unlock original artwork'}
    </Button>
    {visible?.busy && <>
      <Button className="ml-2 mt-2" onClick={cancel}>Cancel read</Button>
      <p role="status" className="mt-2 text-sm text-muted">{visible.phase === 'authorizing' ? 'Approve temporary read access in your wallet…'
        : visible.phase === 'decrypting' ? 'Decrypting and checking the saved artwork…' : 'Verifying artwork, ownership and key services…'}</p>
    </>}
    {visible?.error && <p role="alert" className="mt-2 text-sm text-danger">{visible.error}</p>}
    {visible?.url && <img src={visible.url} alt="Protected original completed Soul artwork" className="mt-3 max-h-96 w-full object-contain" onError={() => {
      if (live.current.scope !== scope || live.current.client !== client || live.current.wallet !== wallet
        || currentUrl.current !== visible.url) return
      if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); currentUrl.current = null }
      setView({ scope, client, wallet, busy: false, error: 'The decrypted image could not be displayed. Please retry.' })
    }} />}
  </div>
}
