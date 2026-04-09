import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export async function requireAdmin(): Promise<
  { error: NextResponse; user: null } | { error: null; user: { id: string; email: string; memberId: string } }
> {
  const result = await requireIdentity()
  if (result.error) {
    // requireIdentity returns NextResponse from web/'s Next.js — cast to local version
    return { error: result.error as unknown as NextResponse, user: null }
  }
  const { identity } = result

  const { prisma } = await import('@web/lib/prisma')
  const account = await prisma.account.findUnique({
    where: { id: identity.accountId },
    select: { email: true },
  })

  if (ADMIN_EMAILS.length === 0) {
    console.error('ADMIN_EMAILS is not configured — admin access denied')
    return {
      error: NextResponse.json({ error: '管理员未配置' }, { status: 403 }),
      user: null,
    }
  }

  if (!account?.email || !ADMIN_EMAILS.includes(account.email.toLowerCase())) {
    return {
      error: NextResponse.json({ error: '无权限' }, { status: 403 }),
      user: null,
    }
  }

  return {
    error: null,
    user: { id: identity.accountId, email: account.email, memberId: identity.memberId },
  }
}
