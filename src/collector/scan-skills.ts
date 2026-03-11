import type { PrismaClient } from '../db/database.js'

const REPO_API = 'https://api.github.com/repos/openclaw/openclaw/contents/skills'
const GITHUB_BASE = 'https://github.com/openclaw/openclaw/tree/main/skills'

interface GitHubContent {
  name: string
  type: string
  url: string
}

interface GitHubFile {
  content: string
  encoding: string
}

function parseFrontmatter(raw: string): { name: string; description: string; emoji: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '', emoji: '🔧' }

  const fm = match[1]

  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*(.+)$/m)

  let emoji = '🔧'
  const metaMatch = fm.match(/^metadata:\s*(.+)$/m)
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1])
      if (meta?.openclaw?.emoji) emoji = meta.openclaw.emoji
    } catch {}
  }

  return {
    name: nameMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    emoji,
  }
}

export async function scanSkills(prisma: PrismaClient): Promise<{ synced: number; removed: number }> {
  console.log(`[${new Date().toISOString()}] Scanning GitHub skills...`)

  // Step 1: List all skill directories
  const res = await fetch(REPO_API, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CryptoOpenClaw' },
  })
  if (!res.ok) {
    console.error(`GitHub API error: ${res.status} ${res.statusText}`)
    return { synced: 0, removed: 0 }
  }

  const contents: GitHubContent[] = await res.json()
  const dirs = contents.filter(c => c.type === 'dir')

  // Step 2: Fetch each SKILL.md and parse frontmatter
  const skills: { name: string; description: string; emoji: string; githubUrl: string }[] = []

  for (const dir of dirs) {
    try {
      const fileRes = await fetch(`${REPO_API}/${dir.name}/SKILL.md`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CryptoOpenClaw' },
      })
      if (!fileRes.ok) continue

      const file: GitHubFile = await fileRes.json()
      const content = Buffer.from(file.content, 'base64').toString('utf-8')
      const parsed = parseFrontmatter(content)

      skills.push({
        name: parsed.name || dir.name,
        description: parsed.description || `${dir.name} skill`,
        emoji: parsed.emoji,
        githubUrl: `${GITHUB_BASE}/${dir.name}`,
      })
    } catch (err) {
      console.error(`Failed to fetch SKILL.md for ${dir.name}:`, err)
    }
  }

  // Step 3: Upsert all skills
  let synced = 0
  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { name: skill.name },
      create: skill,
      update: {
        description: skill.description,
        emoji: skill.emoji,
        githubUrl: skill.githubUrl,
      },
    })
    synced++
  }

  // Step 4: Remove skills no longer on GitHub
  const skillNames = skills.map(s => s.name)
  const removed = await prisma.skill.deleteMany({
    where: { name: { notIn: skillNames } },
  })

  console.log(`Skills sync done: synced ${synced}, removed ${removed.count}`)
  return { synced, removed: removed.count }
}

// CLI entry point
if (process.argv[1]?.endsWith('scan-skills.ts') || process.argv[1]?.endsWith('scan-skills.js')) {
  await import('dotenv/config')
  const { createPrisma } = await import('../db/database.js')
  const prisma = createPrisma()
  await scanSkills(prisma)
  await prisma.$disconnect()
}
