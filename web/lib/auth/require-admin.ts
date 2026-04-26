import { NextResponse } from 'next/server'
import { requireIdentity, requireMutationIdentity } from '@/lib/auth/identity'
import {
  adminAllowlistConfigured,
  isAdminIdentity,
} from '@/lib/auth/admin-allowlist'

export interface RequireAdminOptions {
  /**
   * Pass the incoming `Request` on mutating routes so cookie-based browser
   * sessions must include a matching CSRF token. Header-based auth (agent
   * sig / API key) bypasses CSRF either way.
   */
  mutation?: Request
}

export async function requireAdmin(
  options: RequireAdminOptions = {},
): Promise<
  | { error: NextResponse; user: null }
  | {
      error: null
      user: { id: string; email: string | null; memberId: string; walletAddress: string | null }
    }
> {
  const result = options.mutation
    ? await requireMutationIdentity(options.mutation)
    : await requireIdentity()
  if (result.error) {
    return { error: result.error as unknown as NextResponse, user: null }
  }
  const { identity } = result

  if (!adminAllowlistConfigured()) {
    console.error(
      'Admin allowlist is not configured (ADMIN_EMAILS / ADMIN_WALLET_ADDRESSES) — admin access denied',
    )
    return {
      error: NextResponse.json({ error: '管理员未配置' }, { status: 403 }),
      user: null,
    }
  }

  const { prisma } = await import('@/lib/prisma')
  const [account, member] = await Promise.all([
    prisma.account.findUnique({
      where: { id: identity.accountId },
      select: { email: true },
    }),
    prisma.member.findUnique({
      where: { id: identity.memberId },
      select: {
        walletBindings: {
          where: { chain: 'sui' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { address: true },
        },
      },
    }),
  ])

  const walletAddress = member?.walletBindings[0]?.address ?? null

  if (!isAdminIdentity({ email: account?.email ?? null, walletAddress })) {
    return {
      error: NextResponse.json({ error: '无权限' }, { status: 403 }),
      user: null,
    }
  }

  return {
    error: null,
    user: {
      id: identity.accountId,
      email: account?.email ?? null,
      memberId: identity.memberId,
      walletAddress,
    },
  }
}
