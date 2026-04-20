#!/usr/bin/env tsx
/**
 * 4-manifest.ts
 * 生成 manifest.json，字段结构对齐乌萨奇现有 manifest。
 *
 * 用法：
 *   pnpm tsx desktop/scripts/gen-persona/4-manifest.ts \
 *     --name "柴犬博士" --description "汪！" \
 *     --author-name "十倍" --out ./manifest.json
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Args {
  name: string
  description: string
  authorName?: string
  authorId?: string
  out: string
  sprite?: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { sprite: 'sprite.png' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--name') args.name = argv[++i]
    else if (a === '--description') args.description = argv[++i]
    else if (a === '--author-name') args.authorName = argv[++i]
    else if (a === '--author-id') args.authorId = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--sprite') args.sprite = argv[++i]
  }
  if (!args.name || !args.out) {
    console.error('Usage: 4-manifest.ts --name <name> --out <manifest.json> [--description <d>] [--author-name <n>] [--author-id <uuid>] [--sprite <sprite.png>]')
    process.exit(1)
  }
  if (!args.description) args.description = ''
  return args as Args
}

function main() {
  const { name, description, authorName, authorId, out, sprite } = parseArgs(process.argv.slice(2))

  const manifest = {
    id: randomUUID(),
    name,
    description,
    frameCount: 56,
    frameWidth: 512,
    frameHeight: 512,
    columns: 8,
    rows: 7,
    spriteFile: sprite,
    author: {
      id: authorId ?? randomUUID(),
      displayName: authorName ?? '',
    },
    createdAt: new Date().toISOString(),
    version: '1.0',
  }

  writeFileSync(resolve(out), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  console.log(`[manifest] wrote ${out}`)
}

main()
