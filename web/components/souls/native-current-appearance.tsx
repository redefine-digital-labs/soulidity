'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getBrowserNativeArtworkConfig, readBrowserNativeEquipmentRenderTarget } from '@/lib/animacraft/browser-native-artwork'
import { completeReadStep } from '@/lib/animacraft/native-complete-read-client'
import { renderNativeEquipmentScene } from '@/lib/animacraft/native-equipment-render-client'

/** Public display never requests wallet access or substitutes the original PNG. */
export function NativeCurrentAppearance({ soulId, stateId, owner, ownershipEpoch, className, compact = false }: {
  soulId: string; stateId: string; owner: string; ownershipEpoch: string | null | undefined; className?: string; compact?: boolean
}) {
  const queries = useQueryClient()
  let config: ReturnType<typeof getBrowserNativeArtworkConfig> | null = null; let configError = ''
  try { config = getBrowserNativeArtworkConfig() } catch (error) { configError = error instanceof Error ? error.message : 'Release unavailable' }
  const scope = JSON.stringify([soulId, stateId, owner, ownershipEpoch, config, configError])
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<{ scope: string; url?: string; message?: string; error?: boolean } | null>(null)
  const activeUrl = useRef<string | null>(null)
  const [previousRead, setPreviousRead] = useState({ scope, attempt })
  if (previousRead.scope !== scope || previousRead.attempt !== attempt) { setPreviousRead({ scope, attempt }); setView(null) }
  // Wardrobe already refetches this query after confirmed equipment writes.
  useEffect(() => queries.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success'
      && event.query.queryKey[0] === 'native-equipment' && event.query.queryKey.includes(soulId)) {
      setAttempt(value => value + 1)
    }
  }), [queries, soulId])
  useEffect(() => {
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
    let url: string | null = null
    void (async () => {
      if (!config) throw new Error(configError)
      const readScene = () => readBrowserNativeEquipmentRenderTarget({ soulId, stateId, config, signal })
      const scene = await completeReadStep(signal, readScene)
      if (scene.soulId !== soulId || scene.stateId !== stateId || scene.owner !== owner
        || ownershipEpoch != null && scene.ownershipEpoch !== ownershipEpoch) throw new Error('Soul ownership changed. Refresh the page.')
      signal.throwIfAborted()
      if (scene.status !== 'AVAILABLE') {
        setView({ scope, message: scene.status === 'EMPTY' ? 'No items equipped' : 'No current equipment created' }); return
      }
      if (scene.scene.layers.some(layer => layer.protected)) {
        setView({ scope, message: 'Protected current appearance — open the authorized Wardrobe preview' }); return
      }
      const blob = await completeReadStep(signal, () => renderNativeEquipmentScene(scene,
        { publicOnly: true, soulId, owner, signal, readScene }))
      signal.throwIfAborted()
      url = URL.createObjectURL(blob); activeUrl.current = url; setView({ scope, url })
    })().catch(() => { if (!controller.signal.aborted) setView({ scope, error: true, message: 'Current appearance unavailable' }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); if (activeUrl.current === url) activeUrl.current = null }
  }, [scope, attempt])
  const current = view?.scope === scope ? view : null
  const message = current?.message ?? 'Loading current appearance…'
  return <div aria-label="Current Soul appearance" className={`${className ?? ''} flex items-center justify-center ${compact ? 'p-1' : 'p-3'} text-center text-xs`}>
    {current?.url ? <img src={current.url} alt="Current equipped Soul appearance" className="h-full w-full object-contain"
      onError={() => { if (activeUrl.current !== current.url) return; URL.revokeObjectURL(current.url!); activeUrl.current = null
        setView({ scope, error: true, message: 'Current appearance unavailable' }) }} />
      : <div role="status" title={message} aria-label={message}>{compact ? <span aria-hidden="true">{current?.error ? '!' : !current ? '…' : message.startsWith('Protected') ? '🔒' : '—'}</span> : message}
        {current?.error && <button aria-label="Retry current appearance" className={compact ? 'ml-1' : 'ml-2 underline'}
          onClick={event => { event.preventDefault(); event.stopPropagation(); setAttempt(value => value + 1) }}>{compact ? '↻' : 'Retry current appearance'}</button>}</div>}
  </div>
}
