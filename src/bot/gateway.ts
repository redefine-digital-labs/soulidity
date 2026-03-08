import type { PrismaClient } from '../db/database.js'

interface JoinRequest {
  tg_id: string
  invite_code: string
  createInviteLink: () => Promise<string>
}

interface JoinResult {
  success: boolean
  invite_link?: string
  error?: string
}

export async function processJoinRequest(
  prisma: PrismaClient,
  req: JoinRequest,
): Promise<JoinResult> {
  const invite = await prisma.inviteCode.findFirst({
    where: { code: req.invite_code, active: 1, usedBy: null },
  })

  if (!invite) {
    return { success: false, error: 'Invalid or used invite code' }
  }

  let invite_link: string
  try {
    invite_link = await req.createInviteLink()
  } catch {
    return { success: false, error: 'Failed to create invite link' }
  }

  await prisma.inviteCode.update({
    where: { code: req.invite_code },
    data: { usedBy: req.tg_id, active: 0 },
  })

  await prisma.member.upsert({
    where: { tgId: req.tg_id },
    create: { tgId: req.tg_id, inviteCode: req.invite_code },
    update: {},
  })

  return { success: true, invite_link }
}
