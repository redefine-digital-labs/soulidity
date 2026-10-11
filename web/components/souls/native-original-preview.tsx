'use client'

import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { useCurrentAccount, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Button } from '@/components/ui/button'
import { getBrowserNativeArtworkConfig, readBrowserNativeArtwork } from '@/lib/animacraft/browser-native-artwork'
import { NativeProtectedArtwork } from './native-protected-artwork'

/** Release the UI even if a transport ignores cancellation.
 * The underlying promise stays observed, but can never publish a late result. */
async function previewStep<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { return await Promise.race([run(), aborted]) }
  finally { signal.removeEventListener('abort', onAbort) }
}

/** Show the exact completed PNG, including its chosen dimensions/background.
 * Current equipment rendering is a separate product rule. */
export function NativeOriginalPreview({ soulObjectId, stateObjectId }: { soulObjectId: string; stateObjectId: string }) {
  const account = useCurrentAccount(); const client = useSuiClient()
  const { currentWallet: wallet } = useCurrentWallet()
  let config: ReturnType<typeof getBrowserNativeArtworkConfig> | null = null; let configError = ''
  try { config = getBrowserNativeArtworkConfig() } catch (error) { configError = error instanceof Error ? error.message : 'Artwork release unavailable.' }
  const scope = JSON.stringify([soulObjectId, stateObjectId, account?.address ?? null, config, configError])
  const live = useRef({ scope, client, wallet })
  useLayoutEffect(() => { live.current = { scope, client, wallet } }, [scope, client, wallet])
  const [attempt, setAttempt] = useState(0)
  const displayedUrl = useRef<string | null>(null)
  const [result, setResult] = useState<{ scope: string; client: typeof client; wallet: typeof wallet; url?: string; error?: string; protected?: boolean; pending: boolean } | null>(null)
  const [previousIdentity, setPreviousIdentity] = useState({ scope, client, wallet, attempt })
  if (previousIdentity.scope !== scope || previousIdentity.client !== client || previousIdentity.wallet !== wallet || previousIdentity.attempt !== attempt) {
    setPreviousIdentity({ scope, client, wallet, attempt }); setResult(null)
  }
  useEffect(() => {
    if (!attempt) return
    const controller = new AbortController(); let url: string | null = null
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
    const identity = { scope, client, wallet }
    const matches = () => !signal.aborted && live.current.scope === scope && live.current.client === client && live.current.wallet === wallet
    void (async () => {
      if (!config) throw new Error(configError)
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('Current wallet chain reader is unavailable. Please reconnect.')
      const view = await previewStep(signal, () => readBrowserNativeArtwork({ soulId: soulObjectId,
        config, signal }, { client: () => grpc }))
      if (!view || !['PUBLIC', 'PROTECTED'].includes(view.status)
        || (view.status === 'PUBLIC' && (!(view.blob instanceof Blob) || view.blob.type !== 'image/png'))) {
        throw new Error('The verified original artwork response is invalid.')
      }
      if (view.status === 'PROTECTED') {
        signal.throwIfAborted()
        if (matches()) setResult({ ...identity, pending: false, protected: true })
        return
      }
      signal.throwIfAborted(); if (!matches()) return
      url = URL.createObjectURL(view.blob); displayedUrl.current = url
      setResult({ ...identity, pending: false, url })
    })().catch(error => {
      if (!controller.signal.aborted && live.current.scope === scope && live.current.client === client && live.current.wallet === wallet) setResult({ ...identity, pending: false,
        error: signal.aborted ? 'Original preview timed out. Please retry.'
          : error instanceof Error ? error.message : 'Unable to load the original artwork.' })
    })
    return () => {
      controller.abort()
      if (url && displayedUrl.current === url) { URL.revokeObjectURL(url); displayedUrl.current = null }
    }
  }, [scope, client, wallet, attempt])
  const current = result?.scope === scope && result.client === client && result.wallet === wallet ? result : attempt ? { scope, client, wallet, pending: true, url: undefined, error: undefined, protected: undefined } : null
  return <div className="rounded-xl border border-[var(--border-soft)] p-3" aria-label="Original completed artwork">
    <h4 className="text-sm font-semibold">Original completed artwork</h4>
    <p className="mt-1 text-xs text-muted">The image saved at completion, with its selected size and background.</p>
    <Button className="mt-2" disabled={current?.pending} onClick={() => setAttempt(value => value + 1)}>
      {current?.error ? 'Retry original preview' : 'View original artwork'}
    </Button>
    {current?.pending && <p className="mt-2 text-sm text-muted" role="status">Verifying original artwork…</p>}
    {current?.error && <p className="mt-2 text-sm text-danger" role="alert">{current.error}</p>}
    {current?.protected && <NativeProtectedArtwork soulObjectId={soulObjectId} stateObjectId={stateObjectId} />}
    {current?.url && <img key={current.url} src={current.url} alt="Original completed Soul artwork" className="mt-3 max-h-96 w-full object-contain"
      onError={() => {
        if (displayedUrl.current !== current.url) return
        URL.revokeObjectURL(current.url!); displayedUrl.current = null
        setResult(previous => previous === current ? { scope, client, wallet, pending: false,
          error: 'The original image could not be displayed. Please retry.' } : previous)
      }} />}
  </div>
}
