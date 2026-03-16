interface JoinRequest {
  tg_id: string
  invite_code: string
  createInviteLink: () => Promise<string>
}

interface JoinTransactionClient {
  inviteCode: {
    updateMany(args: {
      where: { code: string; active: number; usedBy: null }
      data: { usedBy: string; active: number }
    }): Promise<{ count: number }>
    findUnique(args: {
      where: { code: string }
      select: { expiresAt: true; active: true; usedBy: true }
    }): Promise<{ expiresAt?: Date | null; active?: number | null; usedBy?: string | null } | null>
  }
  member: {
    findUnique(args: {
      where: { tgId: string }
      select: { inviteCode: true; accountId: true }
    }): Promise<{ inviteCode?: string | null; accountId?: string | null } | null>
    upsert(args: {
      where: { tgId: string }
      create: { tgId: string; inviteCode: string }
      update: { inviteCode: string }
    }): Promise<unknown>
  }
}

interface JoinPrismaClient extends JoinTransactionClient {
  $transaction<T>(callback: (tx: JoinTransactionClient) => Promise<T>): Promise<T>
}

interface JoinResult {
  success: boolean
  invite_link?: string
  register_code?: string
  error?: string
  error_code?: 'ALREADY_REGISTERED' | 'INVALID_OR_USED' | 'EXPIRED' | 'LINK_FAILED'
}

export async function processJoinRequest(
  prisma: JoinPrismaClient,
  req: JoinRequest,
): Promise<JoinResult> {
  const invite = await prisma.inviteCode.findUnique({
    where: { code: req.invite_code },
    select: { expiresAt: true, active: true, usedBy: true },
  })

  if (!invite) {
    return { success: false, error: 'Invalid or used invite code', error_code: 'INVALID_OR_USED' }
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { success: false, error: 'Invite code expired', error_code: 'EXPIRED' }
  }

  const existingMember = await prisma.member.findUnique({
    where: { tgId: req.tg_id },
    select: { inviteCode: true, accountId: true },
  })

  if (existingMember?.accountId) {
    return { success: false, error: 'Already registered', error_code: 'ALREADY_REGISTERED' }
  }

  const canRetryPendingJoin = (
    existingMember !== null &&
    invite.active === 0 &&
    invite.usedBy === req.tg_id &&
    existingMember.accountId === null &&
    existingMember.inviteCode === req.invite_code
  )

  if (canRetryPendingJoin) {
    try {
      const inviteLink = await req.createInviteLink()
      return { success: true, invite_link: inviteLink, register_code: req.invite_code }
    } catch {
      return { success: false, error: 'Failed to create invite link', error_code: 'LINK_FAILED' }
    }
  }

  if (invite.active !== 1 || invite.usedBy !== null) {
    return { success: false, error: 'Invalid or used invite code', error_code: 'INVALID_OR_USED' }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingPendingMember = await tx.member.findUnique({
        where: { tgId: req.tg_id },
        select: { inviteCode: true, accountId: true },
      })

      if (existingPendingMember && existingPendingMember.accountId === null && existingPendingMember.inviteCode) {
        const previousInvite = await tx.inviteCode.findUnique({
          where: { code: existingPendingMember.inviteCode },
          select: { expiresAt: true, active: true, usedBy: true },
        })
        const reusable = previousInvite &&
          previousInvite.usedBy === req.tg_id &&
          (!previousInvite.expiresAt || previousInvite.expiresAt >= new Date())
        if (reusable) {
          return {
            register_code: existingPendingMember.inviteCode,
          }
        }
      }

      const consumed = await tx.inviteCode.updateMany({
        where: { code: req.invite_code, active: 1, usedBy: null },
        data: { usedBy: req.tg_id, active: 0 },
      })

      if (consumed.count === 0) {
        throw new Error('INVITE_RACE')
      }

      await tx.member.upsert({
        where: { tgId: req.tg_id },
        create: { tgId: req.tg_id, inviteCode: req.invite_code },
        update: { inviteCode: req.invite_code },
      })

      return {
        register_code: req.invite_code,
      }
    })

    try {
      const inviteLink = await req.createInviteLink()
      return { success: true, invite_link: inviteLink, register_code: result.register_code }
    } catch {
      return { success: false, error: 'Failed to create invite link', error_code: 'LINK_FAILED' }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITE_RACE') {
      return { success: false, error: 'Invalid or used invite code', error_code: 'INVALID_OR_USED' }
    }
    throw error
  }
}
