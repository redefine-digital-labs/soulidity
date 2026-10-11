import type { MetadataRoute } from 'next'

const siteUrl =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') ??
  'https://clawnews-mu.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/_e2e_fixture/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
