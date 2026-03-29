#!/usr/bin/env node

import 'dotenv/config'

import { resolve } from 'node:path'
import { formatReviewMemoryConfigSource, createReviewMemoryClientFromEnv } from '../src/mcp/review-memory/config.js'
import { findLatestReviewBatchDir, runReviewMemoryBackfill } from '../src/mcp/review-memory/backfill.js'
import { recordReviewMemoryResolution } from '../src/mcp/review-memory/service.js'

function readOption(argv: string[], ...names: string[]) {
  for (let index = 0; index < argv.length; index += 1) {
    if (names.includes(argv[index]!)) {
      return argv[index + 1] ?? null
    }
  }
  return null
}

function printHelp() {
  console.log(`Usage: npm run review-memory:backfill -- [--batch-dir review/batch-0] [--repo clawnews] [--now 2026-03-28T00:00:00.000Z]

Backfills closed review findings from fixed.md, not-issue.md, and todo.md into mem9 review-memory.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    return
  }

  const { config, client } = createReviewMemoryClientFromEnv()
  const repo = readOption(argv, '--repo') ?? config.repo
  const batchDirOption = readOption(argv, '--batch-dir', '--batch')
  const nowIso = readOption(argv, '--now') ?? new Date().toISOString()
  const batchDir = batchDirOption
    ? resolve(process.cwd(), batchDirOption)
    : await findLatestReviewBatchDir(resolve(process.cwd(), 'review'))

  if (!batchDir) {
    throw new Error('No review/batch-N directory found. Pass --batch-dir to specify one explicitly.')
  }

  console.error(`review-memory backfill repo=${repo}; ${formatReviewMemoryConfigSource(config)}`)

  const result = await runReviewMemoryBackfill({
    repo,
    batchDir,
    nowIso,
    recordResolution: async ({ record }) => recordReviewMemoryResolution({ client, record }),
  })

  console.log(`review-memory backfill complete for ${repo}`)
  console.log(`batchDir=${batchDir}`)
  console.log(`processed=${result.processed} created=${result.created} updated=${result.updated}`)
  for (const file of result.files) {
    console.log(`file=${file}`)
  }
}

main().catch((error) => {
  console.error(`review-memory backfill failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
