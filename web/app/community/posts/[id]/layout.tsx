import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'

type Params = { id: string }

async function loadPost(id: string) {
  try {
    return await prisma.post.findUnique({
      where: { id },
      select: {
        title: true,
        content: true,
        type: true,
        tags: true,
        status: true,
      },
    })
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { id } = await params
  const post = await loadPost(id)

  if (!post || post.status !== 'published') {
    return {
      title: 'Post',
      description: 'Soulidity community post.',
      alternates: { canonical: `/community/posts/${id}` },
      robots: { index: false, follow: true },
    }
  }

  const description = post.content.replace(/\s+/g, ' ').trim().slice(0, 200)

  return {
    title: post.title,
    description: description || 'Soulidity community post.',
    keywords: post.tags?.length ? post.tags : undefined,
    alternates: { canonical: `/community/posts/${id}` },
    openGraph: {
      title: `${post.title} · Soulidity Community`,
      description: description || undefined,
      url: `/community/posts/${id}`,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${post.title} · Soulidity Community`,
      description: description || undefined,
    },
  }
}

export default function PostLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
