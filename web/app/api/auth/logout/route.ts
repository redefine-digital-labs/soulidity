import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function POST() {
  const supabase = await createSupabaseServer()
  await supabase.auth.signOut()

  const response = NextResponse.json({ ok: true })
  response.cookies.delete('sb-access-token')
  response.cookies.delete('sb-refresh-token')
  return response
}
