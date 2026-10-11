#!/usr/bin/env tsx
/**
 * 3-stitch.ts
 * 把 56 张 512×512 透明 PNG 拼成 4096×3584 sprite.png。
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/3-stitch.ts \
 *     --frames ./frames/ --out ./sprite.png
 *
 * 帧命名：frames/00.png, frames/01.png, ..., frames/55.png
 * 或 frames/row0_col0.png 形式（自动识别）。
 *
 * 依赖：sharp（需先 `pnpm add -D -w sharp`）
 */

import { readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const FRAME_W = 512
const FRAME_H = 512
const COLUMNS = 8
const ROWS = 7
const TOTAL_FRAMES = COLUMNS * ROWS
const SHEET_W = FRAME_W * COLUMNS
const SHEET_H = FRAME_H * ROWS

interface Args {
  frames: string
  out: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--frames') args.frames = argv[++i]
    else if (a === '--out') args.out = argv[++i]
  }
  if (!args.frames || !args.out) {
    console.error('Usage: 3-stitch.ts --frames <dir> --out <sprite.png>')
    process.exit(1)
  }
  return args as Args
}

/**
 * Resolve frame file path by index. Supports two layouts:
 *  - flat: frames/00.png .. frames/55.png  (zero-padded or not)
 *  - row/col: frames/row0_col0.png
 */
function resolveFrameFile(dir: string, index: number): string {
  const row = Math.floor(index / COLUMNS)
  const col = index % COLUMNS

  const candidates = [
    join(dir, `${String(index).padStart(2, '0')}.png`),
    join(dir, `${index}.png`),
    join(dir, `frame_${String(index).padStart(2, '0')}.png`),
    join(dir, `row${row}_col${col}.png`),
    join(dir, `r${row}c${col}.png`),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `Cannot locate frame ${index} (row ${row}, col ${col}) in ${dir}.\n` +
      `Tried: ${candidates.map(c => c.replace(dir + '/', '')).join(', ')}`,
  )
}

async function main() {
  const { frames, out } = parseArgs(process.argv.slice(2))
  const framesDir = resolve(frames)

  if (!existsSync(framesDir)) {
    console.error(`Frames directory not found: ${framesDir}`)
    process.exit(1)
  }

  // Lazy import sharp so the other scripts can run without it installed.
  let sharp: typeof import('sharp').default
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error('sharp is not installed. Run: pnpm add -D -w sharp')
    process.exit(1)
  }

  console.log(`[stitch] frames: ${framesDir}`)
  console.log(`[stitch] listing: ${readdirSync(framesDir).length} files`)

  const composites: Array<{ input: string; top: number; left: number }> = []
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const file = resolveFrameFile(framesDir, i)
    const row = Math.floor(i / COLUMNS)
    const col = i % COLUMNS
    composites.push({
      input: file,
      top: row * FRAME_H,
      left: col * FRAME_W,
    })
  }

  console.log(`[stitch] compositing ${composites.length} frames into ${SHEET_W}x${SHEET_H}`)

  const canvas = sharp({
    create: {
      width: SHEET_W,
      height: SHEET_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })

  // Ensure each frame is exactly 512x512 before compositing.
  const resizedComposites = await Promise.all(
    composites.map(async c => {
      const buf = await sharp(c.input)
        .resize(FRAME_W, FRAME_H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png()
        .toBuffer()
      return { input: buf, top: c.top, left: c.left }
    }),
  )

  await canvas.composite(resizedComposites).png().toFile(resolve(out))
  console.log(`[stitch] wrote ${out}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
