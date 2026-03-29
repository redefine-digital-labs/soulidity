#!/usr/bin/env node

import 'dotenv/config'

import { createReviewMemoryClientFromEnv, formatReviewMemoryConfigSource } from '../src/mcp/review-memory/config.js'
import type { Mem9Memory } from '../src/mcp/review-memory/mem9-client.js'

interface ParsedReviewMemory {
  uid: string
  repo: string
}

function parseReviewMemory(memory: Mem9Memory): ParsedReviewMemory | null {
  const metadata = memory.metadata
  if (!metadata || typeof metadata !== 'object') {
    return null
  }

  if (typeof metadata.uid !== 'string' || typeof metadata.repo !== 'string') {
    return null
  }

  return {
    uid: metadata.uid,
    repo: metadata.repo,
  }
}

async function listAllMemories() {
  const { client } = createReviewMemoryClientFromEnv()
  const memories: Mem9Memory[] = []
  const pageSize = 200
  let offset = 0

  while (true) {
    const page = await client.search({ limit: pageSize, offset })
    memories.push(...page.data)
    offset += page.data.length
    if (page.data.length < pageSize) {
      break
    }
  }

  return { client, memories }
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const { config } = createReviewMemoryClientFromEnv()
  const repo = (() => {
    const index = argv.findIndex((value) => value === '--repo')
    return index >= 0 ? argv[index + 1] ?? config.repo : config.repo
  })()

  console.error(`review-memory dedupe repo=${repo}; ${formatReviewMemoryConfigSource(config)}`)

  const { client, memories } = await listAllMemories()
  const repoMemories = memories
    .map((memory) => ({ memory, parsed: parseReviewMemory(memory) }))
    .filter((entry): entry is { memory: Mem9Memory; parsed: ParsedReviewMemory } => entry.parsed?.repo === repo)

  const groups = new Map<string, Mem9Memory[]>()
  for (const entry of repoMemories) {
    const existing = groups.get(entry.parsed.uid) ?? []
    existing.push(entry.memory)
    groups.set(entry.parsed.uid, existing)
  }

  let duplicateGroups = 0
  const removals: Mem9Memory[] = []

  for (const memoriesForUid of groups.values()) {
    if (memoriesForUid.length <= 1) {
      continue
    }
    duplicateGroups += 1
    const sorted = [...memoriesForUid].sort((left, right) => {
      if (left.updated_at !== right.updated_at) {
        return right.updated_at.localeCompare(left.updated_at)
      }
      return right.created_at.localeCompare(left.created_at)
    })
    removals.push(...sorted.slice(1))
  }

  if (!dryRun) {
    for (const memory of removals) {
      const removed = await client.remove(memory.id)
      if (!removed) {
        throw new Error(`Failed to remove duplicate memory ${memory.id}`)
      }
    }
  }

  console.log(`review-memory dedupe complete for ${repo}`)
  console.log(`dryRun=${dryRun}`)
  console.log(`repoMemories=${repoMemories.length}`)
  console.log(`duplicateGroups=${duplicateGroups}`)
  console.log(`removed=${removals.length}`)
}

main().catch((error) => {
  console.error(`review-memory dedupe failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
