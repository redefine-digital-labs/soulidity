import { NextResponse, type NextRequest } from 'next/server'

// These routes now rely on client-side AuthGate / CTA interception so users
// can stay on the intended screen and sign in from there.
export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/create/:path*',
    '/import/:path*',
    '/my-souls/:path*',
    '/profile/:path*',
    '/wrap-link/:path*',
    '/souls/:id/sell/:path*',
  ],
}
