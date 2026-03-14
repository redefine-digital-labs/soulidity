import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export async function requireAdmin(): Promise<
  { error: NextResponse; user: null } | { error: null; user: { id: string; email: string } }
> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return {
      error: NextResponse.json({ error: '未登录' }, { status: 401 }),
      user: null,
    }
  }

  if (ADMIN_EMAILS.length === 0) {
    console.error('ADMIN_EMAILS is not configured — admin access denied')
    return {
      error: NextResponse.json({ error: '管理员未配置' }, { status: 403 }),
      user: null,
    }
  }

  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return {
      error: NextResponse.json({ error: '无权限' }, { status: 403 }),
      user: null,
    }
  }

  return { error: null, user: { id: user.id, email: user.email } }
}
