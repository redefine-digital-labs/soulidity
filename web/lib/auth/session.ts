import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || process.env.TG_BOT_TOKEN!)

export async function createSession(memberId: string, tgId: string) {
  const token = await new SignJWT({ memberId, tgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(SECRET)
  const cookieStore = await cookies()
  cookieStore.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600,
    path: '/',
  })
}

export async function getSession(): Promise<{ memberId: string; tgId: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return { memberId: payload.memberId as string, tgId: payload.tgId as string }
  } catch {
    return null
  }
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete('session')
}
