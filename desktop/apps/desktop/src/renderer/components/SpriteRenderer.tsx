import { useRef, useEffect } from 'react'
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

interface SpriteRendererProps {
  config: SpriteSheetConfig
  animation: string
  width?: number
  height?: number
}

export function SpriteRenderer({ config, animation, width, height }: SpriteRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const frameRef = useRef(0)
  const lastTimeRef = useRef(0)
  const currentAnimRef = useRef(animation)

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
    }
  }, [animation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tick = (timestamp: number) => {
      const anim = config.animations[currentAnimRef.current]
      if (!anim || !sheetRef.current) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const interval = 1000 / anim.fps
      if (timestamp - lastTimeRef.current >= interval) {
        lastTimeRef.current = timestamp
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
          frameRef.current = anim.loop ? 0 : anim.frames.length - 1
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [config, displayW, displayH, dpr])

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
