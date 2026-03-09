import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'

export const dynamic = 'force-dynamic'

export default async function DirectionDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params

  const direction = await prisma.direction.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  if (!direction || direction.category.name !== category) {
    notFound()
  }

  const description = direction.descriptionZh || direction.description

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm mb-8 animate-fade-up" style={{ color: 'var(--text-muted)' }}>
          <Link href="/directions" className="transition-colors hover:text-[var(--accent-cyan)]">
            养成方向
          </Link>
          <span>/</span>
          <Link
            href={`/directions/${direction.category.name}`}
            className="transition-colors hover:text-[var(--accent-cyan)]"
          >
            {direction.category.icon} {direction.category.nameZh}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--text-primary)' }}>{direction.nameZh}</span>
        </nav>

        {/* Header card */}
        <div className="glass-panel p-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-4">
            <span className="text-5xl">{direction.icon}</span>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="text-gradient">{direction.nameZh}</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{direction.name}</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>
              {direction.userCount}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>使用人数</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-amber)' }}>
              {direction.rating.toFixed(1)}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>评分</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold">
              {direction.category.icon}
            </div>
            <div className="text-xs mt-1">
              <span className="badge badge-cyan">{direction.category.nameZh}</span>
            </div>
          </div>
        </div>

        {/* Description section */}
        {description && (
          <div className="glass-panel p-6 animate-fade-up" style={{ animationDelay: '150ms' }}>
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>介绍</h2>
            <p className="whitespace-pre-line" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>{description}</p>
          </div>
        )}
      </div>
    </div>
  )
}
