import type { Metadata } from 'next'

/** Static shell only. Public identity is verified by the browser's chain reader;
 * an owned SQL renderer must not resolve handles or invent indexed identity. */
export const metadata: Metadata = {
  title: 'Community profile · Soulidity',
  description: 'Public Soulidity profile, authored Souls and community posts.',
  robots: { index: false, follow: true },
}

export default function CommunityUserSpaceLayout({ children }: { children: React.ReactNode }) {
  return children
}
