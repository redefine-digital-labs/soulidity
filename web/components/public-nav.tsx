'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: '新闻' },
  { href: '/companies', label: '项目追踪' },
  { href: '/directions', label: '养成方向' },
  { href: '/community', label: '社区' },
  { href: '/knowledge', label: '知识库' },
]

export function PublicNav() {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50" style={{ background: 'rgba(250, 250, 250, 0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="max-w-6xl mx-auto px-6 flex items-center h-16 gap-8">
        <Link href="/" className="text-xl font-bold shrink-0" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">CryptoOpenClaw</span>
        </Link>
        <div className="flex gap-1">
          {links.map(link => {
            const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1.5 rounded-md text-sm transition-colors"
                style={{
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  background: isActive ? 'var(--accent-cyan-dim)' : 'transparent',
                }}
                onMouseEnter={e => { if (!isActive) (e.target as HTMLElement).style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { if (!isActive) (e.target as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
        <Link
          href="/login"
          className="ml-auto text-sm transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}
        >
          登录
        </Link>
      </div>
    </nav>
  )
}
