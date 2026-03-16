import { generateInviteCode } from './invite-code-generator'
import { isUniqueConstraintError } from './prisma-errors'

interface InviteCodeWriter {
  inviteCode: {
    create(args: { data: { code: string; expiresAt?: Date } }): Promise<unknown>
  }
}

export async function createInviteCodeRecord(
  db: InviteCodeWriter,
  options: { expiresAt?: Date; attempts?: number } = {}
): Promise<string> {
  const attempts = options.attempts ?? 5

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateInviteCode()
    try {
      await db.inviteCode.create({
        data: {
          code,
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
        },
      })
      return code
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue
      }
      throw error
    }
  }

  throw new Error('Failed to generate a unique invite code')
}
