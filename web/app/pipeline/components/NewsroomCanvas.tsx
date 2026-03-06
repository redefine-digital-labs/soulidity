'use client'

import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'
import { NewsroomSceneManager, SCENE_W, SCENE_H } from '../engine/NewsroomScene'
import { usePipelineStore } from '../store/pipeline-store'

const POLL_INTERVAL = 10_000

export default function NewsroomCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const sceneRef = useRef<NewsroomSceneManager | null>(null)
  const fetchArticles = usePipelineStore((s) => s.fetchArticles)
  const consumeEvents = usePipelineStore((s) => s.consumeEvents)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let destroyed = false
    let pollTimer: ReturnType<typeof setInterval> | undefined

    const setup = async () => {
      // ── Create PixiJS Application ───────────────────────────────
      const app = new Application()
      await app.init({
        width: SCENE_W,
        height: SCENE_H,
        backgroundColor: 0x2a2a44,
        antialias: false,
        roundPixels: true,
      })

      if (destroyed) {
        app.destroy(true)
        return
      }

      appRef.current = app
      container.appendChild(app.canvas as HTMLCanvasElement)

      // ── Create scene manager ──────────────────────────────────
      const scene = new NewsroomSceneManager()
      sceneRef.current = scene
      app.stage.addChild(scene.root)

      // ── Game loop ticker ──────────────────────────────────────
      app.ticker.add((ticker) => {
        const delta = ticker.deltaTime / 60 // Convert to seconds (60fps base)

        // 1. Consume events from store
        const events = usePipelineStore.getState().consumeEvents()

        // 2. Process events if any
        if (events.length > 0) {
          const { articles } = usePipelineStore.getState()
          scene.processEvents(events, articles)
        }

        // 3. Sync articles from store state
        const { articles, pendingArticles } = usePipelineStore.getState()
        scene.syncArticles(articles)

        // 4. Update inbox count
        scene.setInboxCount(pendingArticles.length)

        // 5. Per-frame update
        scene.update(delta)
      })

      // ── Resize handler (scale to fit parent width) ──────────────
      const resize = () => {
        const parent = container.parentElement
        if (!parent) return
        const parentW = parent.clientWidth
        const scale = Math.min(1, parentW / SCENE_W)
        const canvas = app.canvas as HTMLCanvasElement
        canvas.style.width = `${SCENE_W * scale}px`
        canvas.style.height = `${SCENE_H * scale}px`
      }
      resize()
      window.addEventListener('resize', resize)

      // ── Visibility change (pause / resume ticker) ───────────────
      const onVisibility = () => {
        if (document.hidden) {
          app.ticker.stop()
        } else {
          app.ticker.start()
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      // ── API polling ─────────────────────────────────────────────
      usePipelineStore.getState().fetchArticles()
      pollTimer = setInterval(() => {
        usePipelineStore.getState().fetchArticles()
      }, POLL_INTERVAL)

      // ── Cleanup closure stored for unmount ──────────────────────
      return () => {
        window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    let cleanupListeners: (() => void) | undefined

    setup().then((cleanup) => {
      cleanupListeners = cleanup
    })

    return () => {
      destroyed = true
      cleanupListeners?.()
      if (pollTimer) clearInterval(pollTimer)
      if (appRef.current) {
        appRef.current.destroy(true)
        appRef.current = null
      }
      sceneRef.current = null
    }
  }, [fetchArticles, consumeEvents])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        imageRendering: 'pixelated',
      }}
    />
  )
}
