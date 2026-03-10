import { getSession } from './session'
import { NextResponse } from 'next/server'

export async function requireAuth() {
  const session = await getSession()
  if (!session) {
    return { error: NextResponse.json({ error: '请先登录' }, { status: 401 }), session: null }
  }
  return { error: null, session }
}
