'use client'

import { useEffect, useRef, useState } from 'react'
import { isNativeArtworkUrl } from '@/lib/animacraft/artwork-url'
import { getBrowserNativeArtworkConfig, readBrowserNativeArtwork } from '@/lib/animacraft/browser-native-artwork'

/** Native artwork is downloaded only after browser raw provenance and bounded
 * PNG integrity checks. Protected artwork never falls back to a public Blob. */
export function SoulArtworkImage({ src, className, alt = '' }: { src: string; className?: string; alt?: string }) {
  const native = isNativeArtworkUrl(src)
  let config: ReturnType<typeof getBrowserNativeArtworkConfig> | null = null; let configError = ''
  if (native) try { config = getBrowserNativeArtworkConfig() } catch (error) { configError = error instanceof Error ? error.message : 'Artwork release unavailable.' }
  const scope = JSON.stringify([src, config, configError])
  const displayed = useRef<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ scope: string; url?: string; state: 'ready' | 'error' | 'protected' } | null>(null)
  const [previousRead, setPreviousRead] = useState({ scope, attempt })
  if (previousRead.scope !== scope || previousRead.attempt !== attempt) { setPreviousRead({ scope, attempt }); setResult(null) }
  useEffect(() => {
    if (!native) return
    let active = true; let objectUrl: string | undefined
    const controller = new AbortController()
    void (async () => {
      try {
        if (!config) throw new Error(configError)
        const response = await readBrowserNativeArtwork({ soulId: src.slice('soulidity-artwork:'.length), config, signal: controller.signal })
        if (response.status === 'PROTECTED') {
          if (active) setResult({ scope, state: 'protected' })
          return
        }
        const blob = response.blob
        if (!active) return
        if (blob.type !== 'image/png' || blob.size === 0 || blob.size > 12 * 1024 * 1024) throw new Error('Preview size invalid')
        objectUrl = URL.createObjectURL(blob)
        displayed.current = objectUrl
        setResult({ scope, state: 'ready', url: objectUrl })
      } catch { if (active) setResult({ scope, state: 'error' }) }
    })()
    return () => { active = false; controller.abort()
      if (objectUrl && displayed.current === objectUrl) { URL.revokeObjectURL(objectUrl); displayed.current = null }
    }
  }, [scope, native, attempt])
  if (!native) return <img src={src} alt={alt} className={className} />
  const current = result?.scope === scope ? result : null
  if (current?.state === 'ready') return <img key={current.url} src={current.url} alt={alt} className={className}
    onError={() => {
      if (!current.url || displayed.current !== current.url) return
      URL.revokeObjectURL(current.url); displayed.current = null
      setResult(previous => previous === current ? { scope, state: 'error' } : previous)
    }} />
  return <div className={`${className ?? ''} flex items-center justify-center p-2 text-center text-xs`} role="status">
    {current?.state === 'protected' ? 'Protected artwork — authorized preview required'
      : current?.state === 'error' ? <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); setAttempt(value => value + 1) }}>Preview unavailable · Retry</button>
        : 'Loading artwork…'}
  </div>
}
