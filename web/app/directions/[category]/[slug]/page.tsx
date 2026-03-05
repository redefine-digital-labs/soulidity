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
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/directions" className="hover:text-gray-700">
            养成方向
          </Link>
          <span>/</span>
          <Link
            href={`/directions/${direction.category.name}`}
            className="hover:text-gray-700"
          >
            {direction.category.icon} {direction.category.nameZh}
          </Link>
          <span>/</span>
          <span className="text-gray-900">{direction.nameZh}</span>
        </nav>

        {/* Header card */}
        <div className="bg-white rounded-lg border p-6 mb-6">
          <div className="flex items-center gap-4">
            <span className="text-5xl">{direction.icon}</span>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {direction.nameZh}
              </h1>
              <p className="text-sm text-gray-400 mt-1">{direction.name}</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {direction.userCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">使用人数</div>
          </div>
          <div className="bg-white rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {direction.rating.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500 mt-1">评分</div>
          </div>
          <div className="bg-white rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {direction.category.icon}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {direction.category.nameZh}
            </div>
          </div>
        </div>

        {/* Description section */}
        {description && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">介绍</h2>
            <p className="text-gray-700 whitespace-pre-line">{description}</p>
          </div>
        )}
      </div>
    </div>
  )
}
