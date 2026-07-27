import type { Metadata } from 'next'
import { AnimacraftIntegrationClient } from './integration-client'

export const metadata: Metadata = {
  title: 'Animacraft Integration',
  description: 'Continue an Animacraft character as one canonical Soulidity Soul.',
  robots: { index: false, follow: false },
}

type SearchValue = string | string[] | undefined

function first(value: SearchValue): string {
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? ''
}

export default async function AnimacraftIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>
}) {
  const params = await searchParams
  return (
    <AnimacraftIntegrationClient
      handoff={{
        makerId: first(params.maker),
        profileUrl: first(params.profile),
        imageUrl: first(params.image),
        profileBlobId: first(params.profileBlob),
        imageBlobId: first(params.imageBlob),
        recipeHash: first(params.recipeHash),
        walletHint: first(params.wallet),
      }}
    />
  )
}
