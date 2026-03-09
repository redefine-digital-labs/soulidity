'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

const links = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/tweets', label: 'Tweets' },
  { href: '/admin/submit', label: 'Submit' },
  { href: '/companies', label: 'Companies' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/members', label: 'Members' },
  { href: '/knowledge', label: '知识库' },
]

export function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="sticky top-0 z-50" style={{ background: 'rgba(9, 9, 11, 0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="max-w-5xl mx-auto px-6 flex items-center h-14 gap-6">
        <Link href="/admin" className="font-bold text-base shrink-0" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-amber)' }}>
          COC Admin
        </Link>
        <div className="flex gap-1">
          {links.map(link => {
            const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  color: isActive ? 'var(--accent-amber)' : 'var(--text-muted)',
                  background: isActive ? 'var(--accent-amber-dim)' : 'transparent',
                }}
                onMouseEnter={e => { if (!isActive) (e.target as HTMLElement).style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { if (!isActive) (e.target as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
        <button
          onClick={handleLogout}
          className="ml-auto text-xs transition-colors cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--accent-rose)'}
          onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}
        >
          退出
        </button>
      </div>
    </nav>
  )
}
