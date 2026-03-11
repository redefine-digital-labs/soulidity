import type { PrismaClient } from '../db/database.js'

const CLAWHUB_API = 'https://clawhub.ai/api/v1/skills'

interface ClawHubSkill {
  slug: string
  displayName: string
  summary: string
  stats: {
    downloads: number
    stars: number
    versions: number
  }
  latestVersion: {
    version: string
  } | null
}

interface ClawHubResponse {
  items: ClawHubSkill[]
  nextCursor: string | null
}

export async function scanSkills(prisma: PrismaClient): Promise<{ synced: number }> {
  console.log(`[${new Date().toISOString()}] Scanning ClawHub skills...`)

  const skillMap = new Map<string, ClawHubSkill>()
  let cursor: string | null = null

  // Paginate through all skills
  while (true) {
    const url = new URL(CLAWHUB_API)
    url.searchParams.set('limit', '200')
    url.searchParams.set('sort', 'downloads')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'CryptoOpenClaw/0.1' },
    })

    if (!res.ok) {
      console.error(`ClawHub API error: ${res.status} ${res.statusText}`)
      break
    }

    const data: ClawHubResponse = await res.json()
    if (data.items.length === 0) break

    const prevSize = skillMap.size
    for (const item of data.items) {
      skillMap.set(item.slug, item)
    }
    console.log(`  fetched ${skillMap.size} unique skills so far...`)

    // Stop if no new unique items or no cursor
    if (skillMap.size === prevSize || !data.nextCursor) break
    cursor = data.nextCursor
  }

  const skills = Array.from(skillMap.values())

  if (skills.length === 0) {
    console.warn('No skills fetched from ClawHub; skipping sync')
    return { synced: 0 }
  }

  // Upsert individually (no transaction — Supabase pooler has strict timeout)
  let synced = 0
  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { slug: skill.slug },
      create: {
        slug: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary,
        version: skill.latestVersion?.version ?? '1.0.0',
        downloads: skill.stats.downloads,
        stars: skill.stats.stars,
        versions: skill.stats.versions,
      },
      update: {
        displayName: skill.displayName,
        summary: skill.summary,
        version: skill.latestVersion?.version ?? '1.0.0',
        downloads: skill.stats.downloads,
        stars: skill.stats.stars,
        versions: skill.stats.versions,
      },
    })
    synced++
    if (synced % 2000 === 0) {
      console.log(`  upserted ${synced}/${skills.length} skills...`)
    }
  }
  console.log(`  upserted ${synced}/${skills.length} skills...`)

  // Remove skills no longer on ClawHub
  const slugs = skills.map(s => s.slug)
  const removed = await prisma.skill.deleteMany({
    where: { slug: { notIn: slugs } },
  })
  if (removed.count > 0) {
    console.log(`  removed ${removed.count} stale skills`)
  }

  console.log(`Skills sync done: synced ${synced}`)
  return { synced }
}

// CLI entry point
if (process.argv[1]?.endsWith('scan-skills.ts') || process.argv[1]?.endsWith('scan-skills.js')) {
  await import('dotenv/config')
  const { createPrisma } = await import('../db/database.js')
  const prisma = createPrisma()
  await scanSkills(prisma)
  await prisma.$disconnect()
}
