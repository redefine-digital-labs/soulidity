#!/usr/bin/env tsx
/**
 * orchestrate.ts
 * 全流水线：参考图 + 角色名 → data/assets/<角色>/{sprite.png, manifest.json}
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/orchestrate.ts \
 *     --ref ./柴犬.png --name "柴犬博士" --mode two-stage --provider openai
 *
 * 需要先 `pnpm add -D -w sharp`，并设置对应 provider 的 API key 环境变量。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Args {
  ref: string
  name: string
  mode: 'two-stage' | 'one-shot'
  provider: 'openai' | 'gemini'
  params?: string
  assetsRoot: string
  description: string
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_DESKTOP_ROOT = resolve(SCRIPT_DIR, '..', '..') // desktop/

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {
    mode: 'two-stage',
    provider: 'openai',
    assetsRoot: join(REPO_DESKTOP_ROOT, 'data', 'assets'),
    description: '',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') args.ref = argv[++i]
    else if (a === '--name') args.name = argv[++i]
    else if (a === '--mode') args.mode = argv[++i] as Args['mode']
    else if (a === '--provider') args.provider = argv[++i] as Args['provider']
    else if (a === '--params') args.params = argv[++i]
    else if (a === '--assets-root') args.assetsRoot = argv[++i]
    else if (a === '--description') args.description = argv[++i]
  }
  if (!args.ref || !args.name) {
    console.error(
      'Usage: orchestrate.ts --ref <img> --name <char> [--mode two-stage|one-shot] [--provider openai|gemini] [--params <json>] [--description <d>]',
    )
    process.exit(1)
  }
  return args as Args
}

function runStep(label: string, cmd: string[]) {
  console.log(`\n========== ${label} ==========`)
  console.log('$ ' + cmd.join(' '))
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`[orchestrate] step failed: ${label}`)
    process.exit(res.status ?? 1)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cacheRoot = resolve('.cache/gen-persona')
  const cacheDir = join(cacheRoot, args.name)
  const framesDir = join(cacheDir, 'frames')
  const targetDir = resolve(args.assetsRoot, args.name)

  mkdirSync(targetDir, { recursive: true })

  // 2. Generate frames
  const genArgs = [
    'pnpm', 'tsx', join(SCRIPT_DIR, '2-generate.ts'),
    '--ref', args.ref,
    '--name', args.name,
    '--mode', args.mode,
    '--provider', args.provider,
    '--cache-root', cacheRoot,
  ]
  if (args.params) genArgs.push('--params', args.params)
  runStep('2-generate', genArgs)

  if (!existsSync(framesDir)) {
    console.error(`[orchestrate] frames dir missing: ${framesDir}`)
    process.exit(1)
  }

  // 3. Stitch
  const spritePath = join(targetDir, 'sprite.png')
  runStep('3-stitch', [
    'pnpm', 'tsx', join(SCRIPT_DIR, '3-stitch.ts'),
    '--frames', framesDir,
    '--out', spritePath,
  ])

  // 4. Manifest
  const manifestPath = join(targetDir, 'manifest.json')
  runStep('4-manifest', [
    'pnpm', 'tsx', join(SCRIPT_DIR, '4-manifest.ts'),
    '--name', args.name,
    '--description', args.description,
    '--out', manifestPath,
  ])

  // 5. Copy reference image for provenance (optional)
  try {
    copyFileSync(args.ref, join(targetDir, 'reference.png'))
  } catch {
    // best-effort
  }

  console.log(`\n[orchestrate] ✓ persona ready at ${targetDir}`)
  console.log(`             sprite:   ${spritePath}`)
  console.log(`             manifest: ${manifestPath}`)
}

main()
