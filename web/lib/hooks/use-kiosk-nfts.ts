'use client'

import { useQuery } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import { getOptionalSoulidityEnv } from '@soulidity/sdk'

export interface KioskNft {
  objectId: string
  objectType: string
  name: string
  imageUrl: string | null
  description: string | null
}

// Sui package ID for soulidity — objects of this package type are Souls, not external NFTs
const SOULIDITY_PACKAGE = getOptionalSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID') ?? ''

function isSoulidityObject(objectType: string): boolean {
  if (!SOULIDITY_PACKAGE) return false
  return objectType.startsWith(SOULIDITY_PACKAGE + '::')
}

function getDisplayString(
  display: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = display?.[key]
  return typeof value === 'string' ? value : null
}

function extractDisplay(obj: { data?: { objectId?: string; display?: { data?: Record<string, unknown> | null } | null } | null }): { name: string; imageUrl: string | null; description: string | null } {
  const display = obj.data?.display?.data
  return {
    name: getDisplayString(display, 'name') ?? getDisplayString(display, 'title') ?? `Object ${obj.data?.objectId?.slice(0, 8)}…`,
    imageUrl: getDisplayString(display, 'image_url') ?? getDisplayString(display, 'img_url'),
    description: getDisplayString(display, 'description'),
  }
}

async function fetchOwnedNfts(client: ReturnType<typeof useSuiClient>, address: string): Promise<KioskNft[]> {
  const nfts: KioskNft[] = []
  let cursor: string | null | undefined = undefined
  let hasNext = true

  // Paginate through all owned objects
  while (hasNext) {
    const page = await client.getOwnedObjects({
      owner: address,
      options: { showType: true, showDisplay: true },
      cursor: cursor ?? undefined,
      limit: 50,
    })

    for (const obj of page.data) {
      if (!obj.data) continue
      const objectType = obj.data.type
      if (!objectType) continue

      // Skip Sui framework types (Coin, Package, etc.)
      if (objectType.startsWith('0x2::') || objectType.startsWith('0x1::')) continue
      // Skip Soulidity objects (they are Souls, not external NFTs)
      if (isSoulidityObject(objectType)) continue
      // Skip if no display data (likely not an NFT)
      if (!obj.data.display?.data) continue

      const display = extractDisplay(obj)
      nfts.push({
        objectId: obj.data.objectId,
        objectType,
        name: display.name,
        imageUrl: display.imageUrl,
        description: display.description,
      })
    }

    cursor = page.nextCursor
    hasNext = page.hasNextPage
  }

  return nfts
}

export function useKioskNfts(walletAddress?: string | null) {
  const suiClient = useSuiClient()

  return useQuery<KioskNft[]>({
    queryKey: ['kiosk-nfts', walletAddress],
    queryFn: () => fetchOwnedNfts(suiClient, walletAddress!),
    enabled: !!walletAddress,
  })
}
