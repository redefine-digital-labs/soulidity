import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, hmacSign } from '@web/lib/auth'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths that don't need auth
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get(COOKIE_NAME)?.value
  const password = process.env.ADMIN_PASSWORD
  const secret = process.env.AUTH_SECRET

  if (!password || !secret) {
    // Auth not configured — allow access (dev mode)
    return NextResponse.next()
  }

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const expected = await hmacSign(password, secret)
  if (token !== expected) {
    // Invalid token — clear cookie and redirect
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete(COOKIE_NAME)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
