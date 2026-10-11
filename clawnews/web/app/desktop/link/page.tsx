import { redirect } from 'next/navigation'

/**
 * Legacy desktop-link page. Pet management was moved to `/account/pets`
 * along with the rest of the account-area surfaces. We preserve the
 * `?link=<userCode>` query param so existing desktop deep-links still work.
 */
export default async function LegacyDesktopLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params?.link
  const link = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined

  if (typeof link === 'string' && link.length > 0) {
    redirect(`/account/pets?link=${encodeURIComponent(link)}`)
  }

  redirect('/account/pets')
}
