import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Redirects for retired routes
  if (pathname === '/knowledge' || pathname === '/knowledge/') {
    const url = request.nextUrl.clone()
    url.pathname = '/community'
    url.searchParams.set('type', 'knowledge')
    return NextResponse.redirect(url, 301)
  }
  if (pathname.startsWith('/directions')) {
    const url = request.nextUrl.clone()
    url.pathname = '/community'
    url.search = ''
    return NextResponse.redirect(url, 301)
  }

  const isPublicArticlesCollection = pathname === '/api/articles' || pathname === '/api/articles/'

  // Public paths — no auth required
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/admin/login' ||
    pathname === '/verify' ||
    pathname === '/register' ||
    pathname === '/api/register' ||
    pathname.startsWith('/community') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/news') ||
    pathname.startsWith('/skills') ||
    pathname.startsWith('/api/knowledge') ||
    pathname.startsWith('/api/skills') ||
    pathname.startsWith('/api/join') ||
    pathname.startsWith('/api/verify') ||
    isPublicArticlesCollection ||
    pathname.startsWith('/api/community') ||
    pathname === '/api/auth/challenge' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/me' ||
    pathname.startsWith('/market') ||
    pathname.startsWith('/api/market/') ||
    pathname.startsWith('/api/agents') ||
    pathname.startsWith('/api/wallet') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/join-skill.md' ||
    pathname === '/agent-join-skill.md' ||
    pathname.startsWith('/api/agent-join') ||
    pathname === '/agent-claim' ||
    pathname.startsWith('/.well-known/')
  ) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
