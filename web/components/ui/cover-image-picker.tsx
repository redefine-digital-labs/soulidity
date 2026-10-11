'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UploadZone } from './upload-zone'
import { cn } from '@/lib/utils/cn'

/**
 * Cover image picker with baked-in crop step per design-review C7.
 *
 * Flow:
 *   1. User drops any image (JPEG / PNG / WebP).
 *   2. Modal opens with a fixed 1:1 crop frame. User pans + zooms to re-center.
 *   3. On confirm: crop is exported to a 1024×1024 image File. WebP is preferred
 *      (quality steps down from 0.9 until the blob is ≤ OUTPUT_MAX_BYTES); on
 *      browsers/webviews that can't encode WebP, the same loop runs against
 *      JPEG, then finally PNG. That single File is what downstream upload code
 *      handles — same `File` shape the UploadZone used to emit.
 *
 * GIF is intentionally excluded — the canvas export produces a single static
 * frame, so accepting an animated GIF would silently strip its animation.
 *
 * A secondary 4:1 banner variant from the same upload is *not* produced here —
 * the data model only has one cover slot today, so adding it would leak a tail.
 */

const OUTPUT_SIZE = 1024
const OUTPUT_MAX_BYTES = 2 * 1024 * 1024 // 2 MB ceiling per design-review C7
const QUALITY_STEPS = [0.9, 0.85, 0.78, 0.7, 0.6] as const
// Preference order for the canvas encode. WebP first for size, JPEG next for
// broad codec support, PNG last as the universal fallback (spec guarantees it).
const OUTPUT_FORMAT_PREFERENCE = ['image/webp', 'image/jpeg'] as const
const MIN_SCALE = 1
const MAX_SCALE = 4
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ACCEPTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp'
const UNSUPPORTED_TYPE_ERROR = 'Cover image must be PNG, JPEG, or WebP'

interface CoverImagePickerProps {
  /** Currently-selected cropped File, if any. */
  file: File | null
  /** Object URL (or remote URL) suitable for <img src>. Provider owns the lifecycle. */
  previewUrl: string | null
  /** Called with the cropped File (WebP when the browser can encode it, JPEG/PNG otherwise), or null to clear. */
  onChange: (file: File | null) => void
  /** Inline label for the drop zone. */
  label?: string
  /** Hint copy shown under the drop label. */
  sublabel?: string
  /** Tailwind classes forwarded to the drop zone (when no file is selected). */
  className?: string
  icon?: string
}

export function CoverImagePicker({
  file,
  previewUrl,
  onChange,
  label = 'Click to upload cover image',
  sublabel = '1:1 crop · max 2MB · output 1024×1024',
  className,
  icon = '🖼️',
}: CoverImagePickerProps) {
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasSelection = Boolean(file || previewUrl)

  // Revoke the temporary URL we own for the pending (pre-crop) image.
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.url)
    }
  }, [pending])

  const openCropFor = useCallback((input: File) => {
    // `accept` only filters the native file picker — drag-drop bypasses it,
    // so re-check before we waste a crop session. Match the rest of the upload
    // pipeline, which normalizes MIME by extension in `withMime()` and falls
    // back to signature-based validation server-side: accept a canonical MIME
    // OR a supported extension. Empty MIME (some OS/webview integrations omit
    // it) is allowed through so extension fallback can take over. Non-decodable
    // bytes still dead-end in the crop modal's `handleImgError`.
    const ext = input.name.includes('.') ? input.name.split('.').pop()!.toLowerCase() : ''
    const mimeOk = input.type === '' || ACCEPTED_TYPES.has(input.type)
    const extOk = ACCEPTED_EXTENSIONS.has(ext)
    if (!mimeOk && !extOk) {
      setError(UNSUPPORTED_TYPE_ERROR)
      return
    }
    setError(null)
    setPending({ file: input, url: URL.createObjectURL(input) })
  }, [])

  const closeCrop = useCallback(() => {
    setPending((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  const handleConfirm = useCallback(async (cropped: File) => {
    onChange(cropped)
    closeCrop()
  }, [onChange, closeCrop])

  return (
    <>
      {!hasSelection ? (
        <UploadZone
          icon={icon}
          label={label}
          sublabel={sublabel}
          accept={ACCEPT_ATTR}
          onFileSelect={openCropFor}
          className={className}
        />
      ) : (
        <div className="card flex items-center gap-4 border-purple/30 bg-card2/75 px-4 py-4">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Cover preview"
              className="h-14 w-14 shrink-0 rounded-xl border border-purple/25 object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{file?.name ?? 'Current cover image'}</div>
            {file ? (
              <div className="text-xs text-muted">
                {(file.size / 1024).toFixed(1)} KB · 1:1 {describeMime(file.type)} · cropped
              </div>
            ) : (
              <div className="text-xs text-muted">Saved profile cover</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null)
              onChange(null)
            }}
            className="shrink-0 rounded-lg border border-purple/25 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-purple/45 hover:text-foreground"
          >
            {file ? 'Replace' : 'Clear'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-semibold text-danger">{error}</p>
      )}

      {pending && (
        <CropModal
          sourceUrl={pending.url}
          sourceName={pending.file.name}
          onCancel={closeCrop}
          onConfirm={handleConfirm}
          onError={(msg) => setError(msg)}
        />
      )}
    </>
  )
}

/** Modal that loads the source image, lets the user pan/zoom inside a 1:1 frame,
 *  and exports a 1024×1024 WebP File on confirm. */
function CropModal({
  sourceUrl,
  sourceName,
  onCancel,
  onConfirm,
  onError,
}: {
  sourceUrl: string
  sourceName: string
  onCancel: () => void
  onConfirm: (cropped: File) => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const frameSize = useFrameSize(frameRef)

  // Lock page scroll while the crop modal is mounted. Mirrors the shared `Modal`
  // primitive's behavior — without this, mobile touch drags that escape the crop
  // frame can scroll the viewport underneath instead of moving the image.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // When the image loads, fit it so it fully covers the 1:1 frame.
  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) {
      onError('Could not decode this image')
      onCancel()
      return
    }
    setImgSize({ w, h })
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [onError, onCancel])

  // The MIME gate in openCropFor() can be fooled by truncated/corrupt bytes that
  // still claim a supported type. Without this, the preview never sets imgSize
  // and the modal dead-ends with the confirm button stuck disabled.
  const handleImgError = useCallback(() => {
    onError('Could not decode this image')
    onCancel()
  }, [onError, onCancel])

  const baseScale = useMemo(() => {
    if (!imgSize || !frameSize) return 1
    // "Cover" the frame — whichever dimension is shorter relative to the frame needs to scale up.
    return Math.max(frameSize / imgSize.w, frameSize / imgSize.h)
  }, [imgSize, frameSize])

  const displayScale = baseScale * scale
  const displayW = imgSize ? imgSize.w * displayScale : 0
  const displayH = imgSize ? imgSize.h * displayScale : 0

  // Clamp offset so the image never pulls away from the frame edges. Derived — we
  // never write the clamped value back to state, so no cascading renders when zoom
  // shrinks the image and the old offset is now out of range.
  const clampOffset = useCallback((x: number, y: number) => {
    if (!frameSize) return { x, y }
    const maxX = Math.max(0, (displayW - frameSize) / 2)
    const maxY = Math.max(0, (displayH - frameSize) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }, [displayH, displayW, frameSize])

  const clampedOffset = useMemo(() => clampOffset(offset.x, offset.y), [clampOffset, offset.x, offset.y])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true)
    // Drag starts from the currently-visible (clamped) offset, not the raw state —
    // otherwise a zoom-out that clamped the image leaves the next drag off by a gap.
    dragStart.current = { px: e.clientX, py: e.clientY, ox: clampedOffset.x, oy: clampedOffset.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [clampedOffset])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return
    const dx = e.clientX - dragStart.current.px
    const dy = e.clientY - dragStart.current.py
    setOffset(clampOffset(dragStart.current.ox + dx, dragStart.current.oy + dy))
  }, [dragging, clampOffset])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false)
    dragStart.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((prev) => clamp(prev * (e.deltaY < 0 ? 1.08 : 1 / 1.08), MIN_SCALE, MAX_SCALE))
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!imgSize || !frameSize) return
    setBusy(true)
    try {
      const blob = await renderCrop({
        sourceUrl,
        imgSize,
        frameSize,
        baseScale,
        userScale: scale,
        offset: clampedOffset,
      })
      // Trust the blob's own `type`: on browsers that silently fell back to a
      // different format inside `renderCrop`, the label and extension have to
      // match the actual bytes or the server-side signature check rejects it.
      const outType = blob.type || 'image/webp'
      const outName = toCroppedName(sourceName, outType)
      const outFile = new File([blob], outName, { type: outType, lastModified: Date.now() })
      await onConfirm(outFile)
    } catch (err) {
      // Mirror the decode-error path (`handleImgError`): surface the message to the
      // parent and close the modal so the inline error is visible instead of hidden
      // behind the overlay. Without the close, a browser that can't encode WebP
      // leaves the user staring at a re-enabled button with no explanation.
      onError(err instanceof Error ? err.message : 'Crop failed')
      onCancel()
    }
  }, [imgSize, frameSize, sourceUrl, baseScale, scale, clampedOffset, sourceName, onConfirm, onError, onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop cover image"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--ui-overlay)] p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-[min(480px,calc(100vw-2rem))] rounded-[var(--ui-radius-lg)] border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-[var(--ui-shadow-md)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-bold tracking-[-0.01em] text-foreground">Crop cover</div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted"
          >
            Cancel
          </button>
        </div>

        <div className="p-4">
          <div
            ref={frameRef}
            className={cn(
              'relative mx-auto aspect-square w-full max-w-[360px] select-none touch-none overscroll-contain overflow-hidden rounded-xl bg-card2',
              dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl}
              alt=""
              onLoad={handleImgLoad}
              onError={handleImgError}
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: displayW || undefined,
                height: displayH || undefined,
                transform: `translate(-50%, -50%) translate(${clampedOffset.x}px, ${clampedOffset.y}px)`,
              }}
            />
            {/* Crop frame ring — the entire square IS the crop, so the ring is just a visual guide. */}
            <div className="pointer-events-none absolute inset-0 rounded-xl border border-purple/70 shadow-[inset_0_0_0_1px_var(--ui-border-strong)]" />
            {/* Grid thirds */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="border border-white/5"
                  style={{ borderWidth: 0, borderRightWidth: i % 3 < 2 ? 1 : 0, borderBottomWidth: i < 6 ? 1 : 0 }}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Zoom</span>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.01}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="flex-1 accent-purple"
              aria-label="Zoom"
            />
            <span className="font-mono text-[11px] text-muted w-10 text-right">{scale.toFixed(2)}×</span>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Drag to reposition. Scroll or use the slider to zoom. Output: 1024×1024, target ≤ 2 MB (WebP preferred, JPEG or PNG fallback).
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold text-muted transition hover:border-purple hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !imgSize || !frameSize}
            onClick={handleConfirm}
            className="rounded-lg bg-[var(--ui-action)] px-4 py-2 text-xs font-bold tracking-[0.02em] text-[var(--ui-action-text)] transition hover:bg-[var(--ui-action-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? '⟳ Cropping…' : 'Use this crop'}
          </button>
        </div>
      </div>
    </div>
  )
}

function useFrameSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toCroppedName(name: string, mimeType: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'cover'
  const ext = extForMime(mimeType)
  return `${base}.${ext}`
}

function extForMime(mimeType: string): 'webp' | 'jpg' | 'png' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  return 'webp'
}

function describeMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'JPEG'
  if (mimeType === 'image/png') return 'PNG'
  return 'WebP'
}

interface RenderCropParams {
  sourceUrl: string
  imgSize: { w: number; h: number }
  frameSize: number
  baseScale: number
  userScale: number
  offset: { x: number; y: number }
}

async function renderCrop(params: RenderCropParams): Promise<Blob> {
  const { sourceUrl, imgSize, frameSize, baseScale, userScale, offset } = params

  // Re-decode at native resolution for the export.
  const img = await loadImage(sourceUrl)

  // Map frame-space coordinates back to source-image pixel coordinates.
  // displayScale = how many frame pixels one source pixel takes up.
  const displayScale = baseScale * userScale
  const srcSize = frameSize / displayScale
  const srcCenterX = imgSize.w / 2 - offset.x / displayScale
  const srcCenterY = imgSize.h / 2 - offset.y / displayScale
  const sx = clamp(srcCenterX - srcSize / 2, 0, Math.max(0, imgSize.w - srcSize))
  const sy = clamp(srcCenterY - srcSize / 2, 0, Math.max(0, imgSize.h - srcSize))

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  // Try each preferred format in turn. `canvas.toBlob` returns null on
  // non-compliant browsers that don't support the requested MIME (older
  // embedded webviews), or a blob with a substituted `type` on spec-compliant
  // browsers that fell back to PNG. Either way we move on to the next format
  // if we can't land under the size cap. The caller reads `blob.type` to pick
  // the right File MIME and extension.
  for (const format of OUTPUT_FORMAT_PREFERENCE) {
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, format, quality)
      if (blob && blob.size <= OUTPUT_MAX_BYTES) {
        return blob
      }
    }
    // Accept the lowest-quality pass for this format even if slightly over the
    // cap — better than dropping down to a larger format for a few stray bytes.
    const lastBlob = await canvasToBlob(canvas, format, QUALITY_STEPS[QUALITY_STEPS.length - 1])
    if (lastBlob && lastBlob.size <= OUTPUT_MAX_BYTES * 1.1) {
      return lastBlob
    }
  }
  // Final floor: PNG is guaranteed by the canvas spec. Ignore the size cap
  // here so cover selection can still complete on tiny-crop / large-source
  // inputs instead of hard-failing the whole flow.
  const pngBlob = await canvasToBlob(canvas, 'image/png', 1)
  if (pngBlob) return pngBlob
  throw new Error('Failed to encode image')
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load source image'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}
