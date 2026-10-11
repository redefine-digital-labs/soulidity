/**
 * Runtime chroma key for sprite sheets with magenta backgrounds.
 * Ported from Confirmo's applyChromaKeyYUV implementation.
 *
 * Accepts a raw sprite sheet image (with solid magenta background),
 * detects the key color from border pixels, then removes the background
 * using YUV chroma distance + flood fill + distance field edge smoothing
 * + magenta despill on edge pixels.
 */

function rgbToUV(r: number, g: number, b: number): [number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const u = rn * -0.169 + gn * -0.331 + bn * 0.5 + 0.5
  const v = rn * 0.5 + gn * -0.419 + bn * -0.081 + 0.5
  return [u, v]
}

function chromaDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [u1, v1] = rgbToUV(r1, g1, b1)
  const [u2, v2] = rgbToUV(r2, g2, b2)
  const du = u1 - u2
  const dv = v1 - v2
  return Math.sqrt(du * du + dv * dv)
}

interface KeyColor {
  r: number
  g: number
  b: number
  mode: 'magenta' | 'red' | 'unknown'
}

function detectKeyColor(data: Uint8ClampedArray, width: number, height: number): KeyColor {
  const borderPixels: { r: number; g: number; b: number }[] = []

  const sampleBorder = (x: number, y: number) => {
    const i = (y * width + x) * 4
    const a = data[i + 3]
    if (a < 128) return
    borderPixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] })
  }

  const sampleStep = Math.max(1, Math.floor(width / 128))
  for (let x = 0; x < width; x += sampleStep) {
    sampleBorder(x, 0)
    sampleBorder(x, 1)
    sampleBorder(x, height - 1)
    sampleBorder(x, height - 2)
  }
  const sampleStepY = Math.max(1, Math.floor(height / 128))
  for (let y = 0; y < height; y += sampleStepY) {
    sampleBorder(0, y)
    sampleBorder(1, y)
    sampleBorder(width - 1, y)
    sampleBorder(width - 2, y)
  }
  for (let dx = 0; dx < 5; dx++) {
    for (let dy = 0; dy < 5; dy++) {
      sampleBorder(dx, dy)
      sampleBorder(width - 1 - dx, dy)
      sampleBorder(dx, height - 1 - dy)
      sampleBorder(width - 1 - dx, height - 1 - dy)
    }
  }

  if (borderPixels.length === 0) {
    return { r: 255, g: 0, b: 255, mode: 'magenta' }
  }

  let magentaCount = 0
  let magentaR = 0, magentaG = 0, magentaB = 0
  let redCount = 0
  let redR = 0, redG = 0, redB = 0

  for (const { r, g, b } of borderPixels) {
    const minRB = Math.min(r, b)
    const magentaDominance = minRB - g
    const redDominance = r - Math.max(g, b)

    const isMagentaLike =
      (magentaDominance > 30 && r > 70 && b > 70) ||
      (r > g + 40 && b > g + 20 && r > 80 && b > 50) ||
      (b > g + 40 && r > g + 20 && b > 80 && r > 50) ||
      (r > 180 && b > 180 && g < 100) ||
      (r > 150 && b > 150 && g < r * 0.5 && g < b * 0.5)

    if (isMagentaLike) {
      magentaCount++
      magentaR += r
      magentaG += g
      magentaB += b
    } else if (redDominance > 50 && r > 100) {
      redCount++
      redR += r
      redG += g
      redB += b
    }
  }

  if (magentaCount > redCount && magentaCount > 2) {
    return {
      r: Math.round(magentaR / magentaCount),
      g: Math.round(magentaG / magentaCount),
      b: Math.round(magentaB / magentaCount),
      mode: 'magenta',
    }
  }
  if (redCount > 4) {
    return {
      r: Math.round(redR / redCount),
      g: Math.round(redG / redCount),
      b: Math.round(redB / redCount),
      mode: 'red',
    }
  }
  if (magentaCount > 0) {
    return {
      r: Math.round(magentaR / magentaCount),
      g: Math.round(magentaG / magentaCount),
      b: Math.round(magentaB / magentaCount),
      mode: 'magenta',
    }
  }

  return { r: 255, g: 0, b: 255, mode: 'unknown' }
}

function computeDistanceField(bgMask: Uint8Array, width: number, height: number, maxDist: number): Uint8Array {
  const pixelCount = width * height
  const dist = new Uint8Array(pixelCount)
  dist.fill(255)
  const queue: number[] = []

  for (let p = 0; p < pixelCount; p++) {
    if (bgMask[p]) {
      dist[p] = 0
      queue.push(p)
    }
  }

  let head = 0
  while (head < queue.length) {
    const p = queue[head++]
    const d = dist[p]
    if (d >= maxDist) continue
    const x = p % width
    const y = (p / width) | 0
    const newDist = d + 1

    const tryNeighbor = (np: number) => {
      if (dist[np] > newDist) {
        dist[np] = newDist
        queue.push(np)
      }
    }

    if (x > 0) tryNeighbor(p - 1)
    if (x < width - 1) tryNeighbor(p + 1)
    if (y > 0) tryNeighbor(p - width)
    if (y < height - 1) tryNeighbor(p + width)
  }

  return dist
}

function despillMagenta(r: number, g: number, b: number, strength: number): [number, number, number] {
  const minRB = Math.min(r, b)
  const magentaAmount = Math.max(0, minRB - g)
  if (magentaAmount <= 0) return [r, g, b]
  const reduction = magentaAmount * strength
  const newR = Math.max(g, r - reduction)
  const newB = Math.max(g, b - reduction)
  return [Math.round(newR), g, Math.round(newB)]
}

interface ChromaKeyOptions {
  keyColor?: KeyColor
  similarity?: number
  smoothness?: number
  spill?: number
}

/**
 * Apply chroma key removal to an entire canvas in-place.
 * Uses YUV chroma distance + flood fill from edges + distance field
 * for smooth edge anti-aliasing + magenta despill.
 */
export function applyChromaKey(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: ChromaKeyOptions = {},
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const detectedColor = detectKeyColor(data, width, height)
  const keyColor = options.keyColor ?? detectedColor

  const keyR = keyColor.r
  const keyG = keyColor.g
  const keyB = keyColor.b
  const isMagentaKey = detectedColor.mode === 'magenta' || (keyR > keyG + 50 && keyB > keyG + 50)

  const similarity = options.similarity ?? 0.4
  const smoothness = options.smoothness ?? 0.12
  const spill = options.spill ?? 0.15

  const pixelCount = width * height
  const bgMask = new Uint8Array(pixelCount)

  const [keyU, keyV] = rgbToUV(keyR, keyG, keyB)
  const keyMagentaDominance = Math.max(0, Math.min(keyR, keyB) - keyG)

  const isBgCandidate = (p: number): boolean => {
    const i = p * 4
    const a = data[i + 3]
    if (a < 16) return true

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const [u, v] = rgbToUV(r, g, b)
    const du = u - keyU
    const dv = v - keyV
    const chromaDist = Math.sqrt(du * du + dv * dv)
    if (chromaDist < similarity * 0.5) return true

    if (isMagentaKey) {
      const magentaDominance = Math.min(r, b) - g
      if (magentaDominance > keyMagentaDominance * 0.3 && magentaDominance > 40) {
        const rDiff = Math.abs(r - keyR)
        const bDiff = Math.abs(b - keyB)
        if (rDiff < 80 && bDiff < 80) return true
      }
    }

    return false
  }

  // Flood fill from edges
  const queue: number[] = []
  let head = 0

  const trySeed = (p: number) => {
    if (bgMask[p]) return
    if (!isBgCandidate(p)) return
    bgMask[p] = 1
    queue.push(p)
  }

  for (let x = 0; x < width; x++) {
    trySeed(x)
    trySeed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    trySeed(y * width)
    trySeed(y * width + (width - 1))
  }

  while (head < queue.length) {
    const p = queue[head++]
    const x = p % width
    const y = (p / width) | 0
    if (x > 0) trySeed(p - 1)
    if (x < width - 1) trySeed(p + 1)
    if (y > 0) trySeed(p - width)
    if (y < height - 1) trySeed(p + width)
  }

  // Distance field for edge smoothing
  const edgeRadius = 6
  const distField = computeDistanceField(bgMask, width, height, edgeRadius)

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4
    const originalAlpha = data[i + 3]

    if (bgMask[p]) {
      data[i + 3] = 0
      continue
    }
    if (originalAlpha === 0) continue

    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    const distToBg = distField[p]
    const magentaDominance = Math.min(r, b) - g

    if (distToBg <= edgeRadius) {
      const distFactor = distToBg / edgeRadius
      const chromaDist = chromaDistance(r, g, b, keyR, keyG, keyB)
      const baseMask = chromaDist - similarity * 0.2 * (1 + distFactor * 0.5)
      const alpha =
        smoothness > 0
          ? Math.pow(Math.max(0, Math.min(1, baseMask / (smoothness * (0.4 + distFactor * 0.6)))), 1.5)
          : baseMask > 0
            ? 1
            : 0

      if (alpha < 0.02) {
        data[i + 3] = 0
        continue
      }

      const alphaFalloff = distToBg === 1 ? alpha : Math.min(1, alpha + distFactor * 0.2)
      const newAlpha = Math.round(originalAlpha * alphaFalloff)
      data[i + 3] = newAlpha < 8 ? 0 : newAlpha
      if (data[i + 3] === 0) continue

      // Despill magenta from edge pixels
      if (isMagentaKey && magentaDominance > 0) {
        const despillStrength = spill * (1.5 - distFactor * 0.5) * Math.min(1, magentaDominance / 60)
        ;[r, g, b] = despillMagenta(r, g, b, despillStrength)
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
      }

      // Premultiplied alpha correction
      const newAlphaNorm = data[i + 3] / 255
      if (newAlphaNorm > 0.05 && newAlphaNorm < 0.9) {
        const inv = 1 / newAlphaNorm
        const oneMinus = 1 - newAlphaNorm
        data[i] = Math.max(0, Math.min(255, Math.round((data[i] - oneMinus * keyR) * inv)))
        data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - oneMinus * keyG) * inv)))
        data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - oneMinus * keyB) * inv)))
      }
    } else if (isMagentaKey && magentaDominance > 20) {
      // Light despill for interior pixels with magenta tint
      const despillStrength = spill * 0.3 * Math.min(1, magentaDominance / 80)
      ;[r, g, b] = despillMagenta(r, g, b, despillStrength)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Process a sprite sheet image: draw it to an offscreen canvas,
 * apply chroma key, return the processed canvas as an image source.
 * Result is cached — call once per sprite sheet URL.
 */
const processedCache = new Map<string, HTMLCanvasElement>()

export function processSpriteSheeet(img: HTMLImageElement): HTMLCanvasElement {
  const cached = processedCache.get(img.src)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  applyChromaKey(ctx, canvas.width, canvas.height)

  processedCache.set(img.src, canvas)
  return canvas
}
