import type { PrismaClient } from './database.js'
import { createInviteCodeRecord } from '../shared/invite-code-record.js'

export async function createInviteCode(prisma: PrismaClient): Promise<string> {
  return createInviteCodeRecord(prisma)
}

export async function validateInviteCode(prisma: PrismaClient, code: string): Promise<boolean> {
  const row = await prisma.inviteCode.findFirst({
    where: { code, active: 1, usedBy: null },
  })
  return !!row
}

export async function useInviteCode(prisma: PrismaClient, code: string, tgId: string): Promise<boolean> {
  try {
    await prisma.inviteCode.update({
      where: { code, active: 1, usedBy: null },
      data: { usedBy: tgId, active: 0 },
    })
    return true
  } catch {
    return false
  }
}

export async function insertMember(prisma: PrismaClient, tgId: string, tgName: string | null, inviteCode: string): Promise<string> {
  const row = await prisma.member.upsert({
    where: { tgId },
    create: { tgId, tgName, inviteCode },
    update: {},
  })
  return row.id
}

export async function getMembers(prisma: PrismaClient): Promise<Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }>> {
  const rows = await prisma.member.findMany({ orderBy: { joinedAt: 'desc' } })
  return rows.map(r => ({
    id: r.id,
    tg_id: r.tgId,
    tg_name: r.tgName,
    level: r.level,
    joined_at: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : r.joinedAt,
  }))
}
