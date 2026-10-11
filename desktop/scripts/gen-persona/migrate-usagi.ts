#!/usr/bin/env tsx
/**
 * migrate-usagi.ts
 * 把现有的洋红底 sprite.png 就地迁移为透明 PNG。
 *
 * 逻辑：复刻 chroma-key.ts 的核心（YUV 距离 + 像素级 alpha + magenta despill），
 * 但简化掉基于边界的 flood fill 和距离场（离线一次性跑，不追求浏览器端的性能平衡）。
 *
 * 运行前会把原文件备份为 `sprite.png.bak`。
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/migrate-usagi.ts                     # 迁移两个内置 sprite
 *   pnpm tsx desktop/scripts/gen-persona/migrate-usagi.ts --file <path.png>   # 迁移指定文件
 *
 * 依赖：sharp (`pnpm add -D -w sharp`)
 */

import { copyFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_DESKTOP_ROOT = resolve(SCRIPT_DIR, '..', '..') // desktop/

const DEFAULT_TARGETS = [
  resolve(REPO_DESKTOP_ROOT, 'data/assets/乌萨奇！！/sprite.png'),
  resolve(REPO_DESKTOP_ROOT, 'apps/desktop/resources/default-persona/sprite.png'),
]

interface Args {
  files: string[]
  similarity: number
  smoothness: number
  spill: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    similarity: 0.4,
    smoothness: 0.12,
    spill: 0.15,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') args.files.push(argv[++i])
    else if (a === '--similarity') args.similarity = Number(argv[++i])
    else if (a === '--smoothness') args.smoothness = Number(argv[++i])
    else if (a === '--spill') args.spill = Number(argv[++i])
  }
  if (args.files.length === 0) args.files = DEFAULT_TARGETS
  return args
}

function rgbToUV(r: number, g: number, b: number): [number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const u = rn * -0.169 + gn * -0.331 + bn * 0.5 + 0.5
  const v = rn * 0.5 + gn * -0.419 + bn * -0.081 + 0.5
  return [u, v]
}

/**
 * 对一张图应用 chroma key：把 #FF00FF 背景替换为透明，边缘柔化 + magenta despill。
 */
function applyChromaKey(
  data: Buffer,
  width: number,
  height: number,
  opts: { similarity: number; smoothness: number; spill: number },
) {
  const keyR = 255, keyG = 0, keyB = 255
  const [keyU, keyV] = rgbToUV(keyR, keyG, keyB)
  const { similarity, smoothness, spill } = opts

  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const [u, v] = rgbToUV(r, g, b)
    const du = u - keyU
    const dv = v - keyV
    const chromaDist = Math.sqrt(du * du + dv * dv)

    // Full background
    if (chromaDist < similarity * 0.5) {
      data[i + 3] = 0
      continue
    }

    // Edge region: smooth alpha falloff
    const baseMask = chromaDist - similarity * 0.2
    if (baseMask < smoothness) {
      const alpha = Math.pow(Math.max(0, Math.min(1, baseMask / smoothness)), 1.5)
      if (alpha < 0.02) {
        data[i + 3] = 0
        continue
      }
      data[i + 3] = Math.round(data[i + 3] * alpha)

      // Despill magenta on edge
      const magentaAmount = Math.max(0, Math.min(r, b) - g)
      if (magentaAmount > 0) {
        const reduction = magentaAmount * spill * 1.5
        data[i] = Math.max(g, Math.round(r - reduction))
        data[i + 2] = Math.max(g, Math.round(b - reduction))
      }

      // Premultiplied alpha correction
      const aNorm = data[i + 3] / 255
      if (aNorm > 0.05 && aNorm < 0.9) {
        const inv = 1 / aNorm
        const oneMinus = 1 - aNorm
        data[i] = Math.max(0, Math.min(255, Math.round((data[i] - oneMinus * keyR) * inv)))
        data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - oneMinus * keyG) * inv)))
        data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - oneMinus * keyB) * inv)))
      }
      continue
    }

    // Interior pixel with magenta tint → light despill
    const magentaDominance = Math.min(r, b) - g
    if (magentaDominance > 20) {
      const reduction = magentaDominance * spill * 0.3
      data[i] = Math.max(g, Math.round(r - reduction))
      data[i + 2] = Math.max(g, Math.round(b - reduction))
    }
  }
}

async function migrateFile(file: string, opts: Args) {
  if (!existsSync(file)) {
    console.warn(`[migrate] skip (not found): ${file}`)
    return
  }

  const { default: sharp } = await import('sharp')

  const backup = `${file}.bak`
  if (!existsSync(backup)) {
    copyFileSync(file, backup)
    console.log(`[migrate] backup → ${backup}`)
  } else {
    console.log(`[migrate] backup already exists: ${backup}`)
  }

  const img = sharp(file).ensureAlpha()
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error(`no dimensions: ${file}`)

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  console.log(`[migrate] ${file} (${info.width}x${info.height}, ${info.channels}ch)`)

  applyChromaKey(data, info.width, info.height, opts)

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file)

  console.log(`[migrate] wrote transparent → ${file}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[migrate] targets: ${args.files.length}`)
  console.log(`[migrate] params: similarity=${args.similarity} smoothness=${args.smoothness} spill=${args.spill}`)

  for (const file of args.files) {
    await migrateFile(file, args)
  }

  console.log('\n[migrate] ✓ done')
  console.log('[migrate] restore: cp <file>.bak <file>')
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
