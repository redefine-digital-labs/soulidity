import 'dotenv/config'
import { Prisma } from '../generated/prisma/client.js'
import { createPrisma } from '../src/db/database.js'

const STARTER_FILES: Prisma.InputJsonValue = [
  {
    path: 'persona.json',
    url: 'https://cdn.soulidity.local/starters/aurora/persona.json',
    checksum: 'sha256-aurora-persona-v1',
  },
  {
    path: 'avatar.png',
    url: 'https://cdn.soulidity.local/starters/aurora/avatar.png',
    checksum: 'sha256-aurora-avatar-v1',
  },
]

const STARTER_ASSET = {
  slug: 'starter-aurora',
  title: 'Aurora Starter',
  description: 'Default starter persona for anonymous desktop onboarding.',
  coverImage: 'https://cdn.soulidity.local/starters/aurora/cover.png',
  thumbnail: 'https://cdn.soulidity.local/starters/aurora/thumb.png',
  version: '1.0.0',
  checksum: 'sha256-aurora-bundle-v1',
  files: STARTER_FILES,
}

const CURATED_SOUL = {
  onChainId: '0xsoul-desktop-seed-aurora',
  stateOnChainId: '0xstate-desktop-seed-aurora',
  memoryOnChainId: '0xmemory-desktop-seed-aurora',
  creatorAddress: '0xcreator-desktop-seed-aurora',
  currentOwnerAddress: '0xowner-desktop-seed-aurora',
  currentKioskId: '0xkiosk-desktop-seed-aurora',
  currentKioskCapOnChainId: '0xkiosk-cap-desktop-seed-aurora',
  name: 'Aurora Curated Soul',
  description: 'Curated soul fixture for desktop catalog development.',
  imageUrl: 'https://cdn.soulidity.local/souls/aurora/cover.png',
  contentBlobId: 'blob-desktop-seed-aurora',
  contentBlobObjectId: 'obj-desktop-seed-aurora',
  category: 'assistant',
  tags: ['desktop', 'starter'],
  previewImages: ['https://cdn.soulidity.local/souls/aurora/preview-1.png'],
}

async function main() {
  const prisma = createPrisma()

  try {
    const starter = await prisma.starterPersonaAsset.upsert({
      where: { slug: STARTER_ASSET.slug },
      create: STARTER_ASSET,
      update: STARTER_ASSET,
    })

    const soul = await prisma.soulAsset.upsert({
      where: { onChainId: CURATED_SOUL.onChainId },
      create: CURATED_SOUL,
      update: {
        name: CURATED_SOUL.name,
        description: CURATED_SOUL.description,
        imageUrl: CURATED_SOUL.imageUrl,
        category: CURATED_SOUL.category,
        tags: CURATED_SOUL.tags,
        previewImages: CURATED_SOUL.previewImages,
      },
    })

    await prisma.desktopCatalogEntry.upsert({
      where: {
        sourceType_sourceRef: {
          sourceType: 'starter',
          sourceRef: starter.slug,
        },
      },
      create: {
        sourceType: 'starter',
        sourceRef: starter.slug,
        sortOrder: 10,
      },
      update: {
        isPublished: true,
        isHidden: false,
        sortOrder: 10,
      },
    })

    await prisma.desktopCatalogEntry.upsert({
      where: {
        sourceType_sourceRef: {
          sourceType: 'soul',
          sourceRef: soul.onChainId,
        },
      },
      create: {
        sourceType: 'soul',
        sourceRef: soul.onChainId,
        sortOrder: 20,
      },
      update: {
        isPublished: true,
        isHidden: false,
        sortOrder: 20,
      },
    })

    console.log(`Seeded desktop starter asset: ${starter.slug}`)
    console.log(`Seeded desktop curated soul entry: ${soul.onChainId}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
