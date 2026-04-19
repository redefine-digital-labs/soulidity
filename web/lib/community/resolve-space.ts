import { prisma } from '@web/lib/prisma'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveMemberSpaceId(spaceId: string): Promise<string | null> {
  if (!spaceId) return null

  const where = UUID_RE.test(spaceId)
    ? { id: spaceId }
    : { handle: spaceId.toLowerCase() }

  const member = await prisma.member.findFirst({ where, select: { id: true } })
  return member?.id ?? null
}
