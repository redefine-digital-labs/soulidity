'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@web/components/auth-provider'

const links = [
  { href: '/', label: '新闻' },
  { href: '/skills', label: '技能' },
  { href: '/directions', label: '养成方向' },
  { href: '/community', label: '社区' },
  { href: '/knowledge', label: '知识库' },
]

export function PublicNav() {
  const pathname = usePathname()
  const { user, loading, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const displayName = user?.tgName ?? '用户'
  const avatarChar = displayName.charAt(0).toUpperCase()

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

        {loading ? (
          <div className="ml-auto w-8 h-8" />
        ) : user ? (
          <div className="ml-auto relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{avatarChar}</div>
              )}
              <span className="text-sm hidden sm:inline">{displayName}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 rounded-lg shadow-lg py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                <Link href={`/u/${user.id}`} className="block px-4 py-2 text-sm transition-colors" style={{ color: 'var(--text-secondary)' }} onClick={() => setMenuOpen(false)}>
                  个人主页
                </Link>
                <button
                  onClick={async () => { setMenuOpen(false); await logout() }}
                  className="block w-full text-left px-4 py-2 text-sm transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="ml-auto text-sm transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'}
            onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}
          >
            登录
          </Link>
        )}
      </div>
    </nav>
  )
}
