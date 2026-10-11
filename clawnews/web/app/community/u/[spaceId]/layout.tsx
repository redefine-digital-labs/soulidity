import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { resolveMemberSpaceId } from '@/lib/community/resolve-space'

type Params = { spaceId: string }

async function loadSpace(spaceId: string) {
  const memberId = await resolveMemberSpaceId(spaceId)
  if (!memberId) return null
  try {
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        displayName: true,
        tgName: true,
        handle: true,
        bio: true,
        coverImage: true,
      },
    })
    return member
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { spaceId } = await params
  const space = await loadSpace(spaceId)

  if (!space) {
    return {
      title: 'Community space',
      description: 'Soulidity community member space.',
      alternates: { canonical: `/community/u/${spaceId}` },
      robots: { index: false, follow: true },
    }
  }

  // Canonicalize on the member UUID so the `/community/u/<handle>` alias
  // does not fork into a duplicate indexed page. First-party internal links
  // (app-shell, community feed, profile settings copy) already emit the
  // id-based URL, so id is the consistent canonical identifier.
  const canonicalPath = `/community/u/${space.id}`

  const name = space.displayName || space.tgName || space.handle || 'Community member'
  const title = `${name}'s Space`
  const description = space.bio?.slice(0, 200) || `${name} on the Soulidity community.`
  const ogImages = space.coverImage ? [{ url: space.coverImage }] : undefined

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${title} · Soulidity Community`,
      description,
      url: canonicalPath,
      type: 'profile',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · Soulidity Community`,
      description,
      images: space.coverImage ? [space.coverImage] : undefined,
    },
  }
}

export default function CommunityUserSpaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
