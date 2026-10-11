'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

/**
 * Legacy desktop-link page. Pet management was moved to `/account/pets`
 * along with the rest of the account-area surfaces. We preserve the
 * `?link=<userCode>` query param so existing desktop deep-links still work.
 */
function DesktopLinkRedirect() {
  const search = useSearchParams()
  const router = useRouter()
  const link = search.get('link')
  const destination = link ? `/account/pets?link=${encodeURIComponent(link)}` : '/account/pets'
  useEffect(() => { router.replace(destination) }, [router, destination])
  return <p role="status">Opening device pairing… <Link href={destination} replace>Continue to your pets</Link></p>
}

export default function LegacyDesktopLinkPage() {
  return <Suspense fallback={<p role="status">Opening device pairing…</p>}><DesktopLinkRedirect /></Suspense>
}
