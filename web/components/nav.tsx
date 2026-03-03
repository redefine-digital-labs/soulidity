'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/companies', label: 'Companies' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/members', label: 'Members' },
]

export function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  if (pathname === '/login') return null

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="border-b bg-white">
      <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-6">
        <Link href="/dashboard" className="font-bold text-lg">ClawNews</Link>
        <div className="flex gap-4">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm ${pathname === link.href ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <button
          onClick={handleLogout}
          className="ml-auto text-sm text-gray-500 hover:text-gray-700"
        >
          退出
        </button>
      </div>
    </nav>
  )
}
