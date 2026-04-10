import type { PrismaClient } from './database.js'

export async function insertMember(prisma: PrismaClient, tgId: string, tgName: string | null): Promise<string> {
  const row = await prisma.member.upsert({
    where: { tgId },
    create: { tgId, tgName },
    update: {},
  })
  return row.id
}

export async function getMembers(prisma: PrismaClient): Promise<Array<{ id: string; tg_id: string | null; tg_name: string | null; level: number; joined_at: string }>> {
  const rows = await prisma.member.findMany({ orderBy: { joinedAt: 'desc' } })
  return rows.map((r) => ({
    id: r.id,
    tg_id: r.tgId,
    tg_name: r.tgName,
    level: r.level,
    joined_at: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : r.joinedAt,
  }))
}
