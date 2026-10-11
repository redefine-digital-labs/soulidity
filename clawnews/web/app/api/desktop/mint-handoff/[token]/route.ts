import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireIdentity } from '@/lib/auth/identity'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ token: string }>
}

function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params
  if (!token || typeof token !== 'string' || !token.startsWith('mh_')) {
    return fail(404, 'Hand-off not found')
  }

  // Web session cookie auth — the user opens the hand-off URL inside their
  // browser after desktop calls shell.openExternal. The accountId on the row
  // must match the identity resolved from the cookie; otherwise a leaked
  // token would let any logged-in user hydrate someone else's draft.
  const auth = await requireIdentity()
  if (auth.error) return auth.error
  if (auth.identity.kind !== 'human') {
    return fail(403, 'Only human accounts can consume mint hand-offs')
  }

  const row = await prisma.desktopMintHandoff.findUnique({
    where: { token },
    select: {
      id: true,
      accountId: true,
      payload: true,
      expiresAt: true,
      consumedAt: true,
    },
  })

  if (!row) return fail(404, 'Hand-off not found')

  // accountId mismatch → return 404, not 403, to avoid disclosing existence
  // of the token to an unrelated logged-in user.
  if (row.accountId !== auth.identity.accountId) {
    return fail(404, 'Hand-off not found')
  }

  if (row.consumedAt) {
    return fail(410, 'Hand-off already consumed')
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return fail(410, 'Hand-off expired')
  }

  // One-shot consumption: atomically mark consumedAt before returning the
  // payload so a refreshed /create page or a second tab can't re-hydrate
  // from the same token. The user's CreateSoulProvider state is
  // sessionStorage-backed locally, so a single hydrate is enough.
  // updateMany lets us put non-unique guard predicates into `where` while
  // still using the unique `id` — prisma rejects that combo on `update`.
  const consumed = await prisma.desktopMintHandoff.updateMany({
    where: {
      id: row.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  })

  if (consumed.count === 0) {
    // Lost the race against another tab.
    return fail(410, 'Hand-off already consumed')
  }

  return NextResponse.json({ payload: row.payload })
}
