import { useRef, useEffect, useCallback } from 'react'
import { processSpriteSheeet } from '../lib/chroma-key'

export interface SpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [stateName: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}

export function resolveAnimationName({
  animations,
  requestedAnimation,
  fallbackAnimation = 'idle',
}: {
  animations: SpriteSheetConfig['animations']
  requestedAnimation: string
  fallbackAnimation?: string
}): string {
  if (animations[requestedAnimation]) return requestedAnimation
  if (animations[fallbackAnimation]) return fallbackAnimation

  const firstAvailable = Object.keys(animations)[0]
  return firstAvailable ?? requestedAnimation
}

interface SpriteRendererProps {
  config: SpriteSheetConfig
  animation: string
  width?: number
  height?: number
  /** idle 间歇模式：播一次完整帧序列 → 停 idlePauseMs → 再播 */
  idlePause?: boolean
  /** 间歇等待时间范围 [min, max] 毫秒，默认 [3000, 6000] */
  idlePauseRange?: [number, number]
}

export function SpriteRenderer({
  config, animation, width, height,
  idlePause = false, idlePauseRange = [3000, 6000],
}: SpriteRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const frameRef = useRef(0)
  const lastTimeRef = useRef(0)
  const currentAnimRef = useRef(animation)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedRef = useRef(false)

  const displayW = width ?? config.frameWidth
  const displayH = height ?? config.frameHeight
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1

  useEffect(() => {
    const img = new Image()
    img.src = config.src
    img.onload = () => {
      sheetRef.current = processSpriteSheeet(img)
    }
    return () => { sheetRef.current = null }
  }, [config.src])

  useEffect(() => {
    if (animation !== currentAnimRef.current) {
      currentAnimRef.current = animation
      frameRef.current = 0
      lastTimeRef.current = 0
      isPausedRef.current = false
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
    }
  }, [animation])

  const schedulePause = useCallback(() => {
    const [min, max] = idlePauseRange
    const delay = min + Math.random() * (max - min)
    pauseTimerRef.current = setTimeout(() => {
      isPausedRef.current = false
      pauseTimerRef.current = null
    }, delay)
  }, [idlePauseRange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tick = (timestamp: number) => {
      const resolvedAnimation = resolveAnimationName({
        animations: config.animations,
        requestedAnimation: currentAnimRef.current,
      })
      const anim = config.animations[resolvedAnimation]
      if (!anim || !sheetRef.current) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const interval = 1000 / anim.fps

      if (timestamp - lastTimeRef.current >= interval) {
        lastTimeRef.current = timestamp

        // 如果在 idle 间歇暂停中，保持当前帧不变
        if (isPausedRef.current) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }

        const frameIndex = anim.frames[frameRef.current]
        const col = frameIndex % config.columns
        const row = Math.floor(frameIndex / config.columns)

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, displayW, displayH)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(
          sheetRef.current,
          col * config.frameWidth, row * config.frameHeight,
          config.frameWidth, config.frameHeight,
          0, 0, displayW, displayH,
        )

        frameRef.current++
        if (frameRef.current >= anim.frames.length) {
          if (idlePause && resolvedAnimation === 'idle') {
            // idle 间歇：播完一轮后暂停，停在第 0 帧
            frameRef.current = 0
            isPausedRef.current = true
            schedulePause()
          } else {
            frameRef.current = anim.loop ? 0 : anim.frames.length - 1
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [config, displayW, displayH, dpr, idlePause, schedulePause])

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(displayW * dpr)}
      height={Math.round(displayH * dpr)}
      style={{ width: displayW, height: displayH }}
      aria-hidden="true"
    />
  )
}
