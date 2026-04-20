#!/usr/bin/env tsx
/**
 * 1-prompt.ts
 * 读取角色参数 JSON，输出中英双语提示词到 stdout。
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/1-prompt.ts \
 *     --params ./params.json --mode two-stage|one-shot|both
 *
 * params.json 结构见 README.md。
 */

import { readFileSync } from 'node:fs'
import { buildAllPrompts, type CharacterParams, type PromptMode } from './lib/prompts.ts'

interface Args {
  params: string
  mode: PromptMode
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { mode: 'both' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--params') args.params = argv[++i]
    else if (a === '--mode') args.mode = argv[++i] as PromptMode
  }
  if (!args.params) {
    console.error('Usage: 1-prompt.ts --params <path.json> [--mode two-stage|one-shot|both]')
    process.exit(1)
  }
  if (!['two-stage', 'one-shot', 'both'].includes(args.mode!)) {
    console.error(`Invalid mode: ${args.mode}`)
    process.exit(1)
  }
  return args as Args
}

function main() {
  const { params, mode } = parseArgs(process.argv.slice(2))
  const raw = JSON.parse(readFileSync(params, 'utf-8')) as CharacterParams
  if (!raw.referenceDescription) {
    console.error('params.json missing required field: referenceDescription')
    process.exit(1)
  }
  process.stdout.write(buildAllPrompts(raw, mode) + '\n')
}

main()
