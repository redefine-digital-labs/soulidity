'use client'

import { usePathname } from 'next/navigation'
import { Nav } from '@web/components/nav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  return (
    <>
      <Nav />
      {children}
    </>
  )
}
