#!/usr/bin/env tsx
/**
 * 2-generate.ts
 * 调生图 API，把 56 帧写到 .cache/<角色>/frames/ 下。
 *
 * 两阶段模式（--mode two-stage）：
 *   A-1: 用中/英提示词 + 参考图，生成 7 张 keyframe → .cache/<角色>/keyframes/
 *   A-2: 对每张 keyframe 用 loop 提示词再跑一次，各出 8 帧 → frames/00..55.png
 *
 * 单次模式（--mode one-shot）：
 *   直接一张 4096×3584 sprite sheet → 切 56 格 → frames/
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/2-generate.ts \
 *     --ref ./柴犬.png --name "柴犬博士" --mode two-stage --provider openai
 *
 * 需要先 `pnpm add -D -w sharp`。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

import {
  STATE_ROWS,
  buildKeyframePromptEN,
  buildLoopPrompt,
  buildOneShotPrompt,
  type CharacterParams,
} from './lib/prompts.ts'
import { createProvider, type ProviderName } from './lib/providers.ts'

interface Args {
  ref: string
  name: string
  mode: 'two-stage' | 'one-shot'
  provider: ProviderName
  params?: string
  cacheRoot: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {
    mode: 'two-stage',
    provider: 'openai',
    cacheRoot: '.cache/gen-persona',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') args.ref = argv[++i]
    else if (a === '--name') args.name = argv[++i]
    else if (a === '--mode') args.mode = argv[++i] as Args['mode']
    else if (a === '--provider') args.provider = argv[++i] as ProviderName
    else if (a === '--params') args.params = argv[++i]
    else if (a === '--cache-root') args.cacheRoot = argv[++i]
  }
  if (!args.ref || !args.name) {
    console.error(
      'Usage: 2-generate.ts --ref <img> --name <char> [--mode two-stage|one-shot] [--provider openai|gemini] [--params <params.json>]',
    )
    process.exit(1)
  }
  return args as Args
}

function loadParams(argPath: string | undefined, name: string): CharacterParams {
  if (!argPath) {
    return { referenceDescription: name }
  }
  const raw = JSON.parse(readFileSync(argPath, 'utf-8')) as CharacterParams
  if (!raw.referenceDescription) raw.referenceDescription = name
  return raw
}

async function runTwoStage(args: Args, params: CharacterParams, outDir: string) {
  const { default: sharp } = await import('sharp')
  const provider = createProvider(args.provider)

  const keyframesDir = join(outDir, 'keyframes')
  const framesDir = join(outDir, 'frames')
  mkdirSync(keyframesDir, { recursive: true })
  mkdirSync(framesDir, { recursive: true })

  console.log(`[gen] stage A-1: 7 keyframes via ${provider.name}`)
  const keyframePrompt = buildKeyframePromptEN(params)
  const { images: keyframes } = await provider.generate({
    prompt: keyframePrompt,
    referenceImagePath: args.ref,
    count: 7,
    size: 1024,
  })
  if (keyframes.length !== 7) {
    console.warn(`[gen] expected 7 keyframes, got ${keyframes.length}`)
  }
  for (let i = 0; i < keyframes.length; i++) {
    const out = join(keyframesDir, `${STATE_ROWS[i].name}.png`)
    await sharp(keyframes[i]).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out)
    console.log(`  [A-1] ${STATE_ROWS[i].name} → ${out}`)
  }

  console.log(`[gen] stage A-2: 8-frame loops per state`)
  for (let row = 0; row < STATE_ROWS.length; row++) {
    const state = STATE_ROWS[row]
    const keyPath = join(keyframesDir, `${state.name}.png`)
    if (!existsSync(keyPath)) {
      console.warn(`  skip ${state.name}: keyframe missing`)
      continue
    }
    const loopPrompt = buildLoopPrompt(state.name, state.intensity)
    const { images: loopFrames } = await provider.generate({
      prompt: loopPrompt,
      referenceImagePath: keyPath,
      count: 8,
      size: 1024,
    })
    for (let col = 0; col < 8; col++) {
      const frameIndex = row * 8 + col
      const src = loopFrames[col] ?? loopFrames[loopFrames.length - 1]
      const out = join(framesDir, `${String(frameIndex).padStart(2, '0')}.png`)
      await sharp(src).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out)
    }
    console.log(`  [A-2] ${state.name} (row ${row}) → 8 frames`)
  }

  console.log(`[gen] done → ${framesDir}`)
}

async function runOneShot(args: Args, params: CharacterParams, outDir: string) {
  const { default: sharp } = await import('sharp')
  const provider = createProvider(args.provider)

  const framesDir = join(outDir, 'frames')
  mkdirSync(framesDir, { recursive: true })

  console.log(`[gen] one-shot sprite sheet via ${provider.name}`)
  const prompt = buildOneShotPrompt(params)
  const { images } = await provider.generate({
    prompt,
    referenceImagePath: args.ref,
    count: 1,
    size: 1024,
  })
  const sheetBuf = images[0]
  if (!sheetBuf) throw new Error('provider returned no image')

  const sheetPath = join(outDir, 'one-shot-sheet.png')
  writeFileSync(sheetPath, sheetBuf)
  console.log(`  raw sheet → ${sheetPath}`)

  const meta = await sharp(sheetBuf).metadata()
  if (!meta.width || !meta.height) throw new Error('sheet has no dimensions')

  const cellW = Math.floor(meta.width / 8)
  const cellH = Math.floor(meta.height / 7)
  console.log(`[gen] slicing ${meta.width}x${meta.height} into 8x7 cells (${cellW}x${cellH})`)

  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 8; col++) {
      const frameIndex = row * 8 + col
      const out = join(framesDir, `${String(frameIndex).padStart(2, '0')}.png`)
      await sharp(sheetBuf)
        .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(out)
    }
  }
  console.log(`[gen] done → ${framesDir}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const params = loadParams(args.params, args.name)

  const outDir = resolve(args.cacheRoot, args.name)
  mkdirSync(outDir, { recursive: true })
  console.log(`[gen] cache dir: ${outDir}`)

  if (args.mode === 'two-stage') {
    await runTwoStage(args, params, outDir)
  } else {
    await runOneShot(args, params, outDir)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
