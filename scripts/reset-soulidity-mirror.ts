import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/db/prisma-client.js'

// Soulidity mirror reset.
//
// Wipes every DB row that mirrors on-chain Soulidity state for the current
// deployment so the web app starts clean against a freshly-published mainnet
// package. Identity (Member/Account/WalletBinding/WalletChallenge), the news
// pipeline (RawItem/Article/ArticleCompany/Publication), community
// (Post/Comment/PostVote/Achievement/MemberAchievement/Skill), starter persona
// (StarterPersonaAsset), Telegram auth, and desktop device sessions are
// preserved.
//
// Usage:
//   npx tsx scripts/reset-soulidity-mirror.ts --dry-run   (default; no writes)
//   npx tsx scripts/reset-soulidity-mirror.ts --apply

interface CliOptions {
  apply: boolean
}

function parseArgs(argv: string[]): CliOptions {
  let apply = false
  let dryRunSeen = false
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') {
      apply = true
    } else if (arg === '--dry-run') {
      dryRunSeen = true
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }

  if (apply && dryRunSeen) {
    console.error('--apply and --dry-run are mutually exclusive')
    process.exit(1)
  }

  return { apply }
}

function printUsage() {
  console.log(`Usage: npx tsx scripts/reset-soulidity-mirror.ts [--dry-run|--apply]

  --dry-run   (default) Print row counts without modifying the database.
  --apply     Run the deletes inside a single transaction.
`)
}

interface ResetCounts {
  contentAccessRecord: number
  soulSkillVersionRecord: number
  soulMemoryEntry: number
  soulGrantRecord: number
  soulAssetVersionRecord: number
  bookmark: number
  soulPreparedPurchase: number
  soulUploadBinding: number
  soulTxSync: number
  desktopCatalogSoulEntry: number
  desktopProfileWithActiveSoul: number
  soulAsset: number
  soulCollectionAsset: number
}

async function collectCounts(prisma: PrismaClient): Promise<ResetCounts> {
  const [
    contentAccessRecord,
    soulSkillVersionRecord,
    soulMemoryEntry,
    soulGrantRecord,
    soulAssetVersionRecord,
    bookmark,
    soulPreparedPurchase,
    soulUploadBinding,
    soulTxSync,
    desktopCatalogSoulEntry,
    desktopProfileWithActiveSoul,
    soulAsset,
    soulCollectionAsset,
  ] = await Promise.all([
    prisma.contentAccessRecord.count(),
    prisma.soulSkillVersionRecord.count(),
    prisma.soulMemoryEntry.count(),
    prisma.soulGrantRecord.count(),
    prisma.soulAssetVersionRecord.count(),
    prisma.bookmark.count(),
    prisma.soulPreparedPurchase.count(),
    prisma.soulUploadBinding.count(),
    prisma.soulTxSync.count(),
    prisma.desktopCatalogEntry.count({ where: { sourceType: 'soul' } }),
    prisma.desktopProfile.count({ where: { activeSourceType: 'soul' } }),
    prisma.soulAsset.count(),
    prisma.soulCollectionAsset.count(),
  ])

  return {
    contentAccessRecord,
    soulSkillVersionRecord,
    soulMemoryEntry,
    soulGrantRecord,
    soulAssetVersionRecord,
    bookmark,
    soulPreparedPurchase,
    soulUploadBinding,
    soulTxSync,
    desktopCatalogSoulEntry,
    desktopProfileWithActiveSoul,
    soulAsset,
    soulCollectionAsset,
  }
}

function printCounts(label: string, counts: ResetCounts) {
  console.log(label)
  console.log(`  ContentAccessRecord:                    ${counts.contentAccessRecord}`)
  console.log(`  SoulSkillVersionRecord:                 ${counts.soulSkillVersionRecord}`)
  console.log(`  SoulMemoryEntry:                        ${counts.soulMemoryEntry}`)
  console.log(`  SoulGrantRecord:                        ${counts.soulGrantRecord}`)
  console.log(`  SoulAssetVersionRecord:                 ${counts.soulAssetVersionRecord}`)
  console.log(`  Bookmark:                               ${counts.bookmark}`)
  console.log(`  SoulPreparedPurchase:                   ${counts.soulPreparedPurchase}`)
  console.log(`  SoulUploadBinding:                      ${counts.soulUploadBinding}`)
  console.log(`  SoulTxSync:                             ${counts.soulTxSync}`)
  console.log(`  DesktopCatalogEntry (sourceType=soul):  ${counts.desktopCatalogSoulEntry}`)
  console.log(`  DesktopProfile (activeSourceType=soul): ${counts.desktopProfileWithActiveSoul}`)
  console.log(`  SoulAsset:                              ${counts.soulAsset}`)
  console.log(`  SoulCollectionAsset:                    ${counts.soulCollectionAsset}`)
}

async function main() {
  const { apply } = parseArgs(process.argv)

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const before = await collectCounts(prisma)
    printCounts(apply ? 'Pre-reset row counts' : 'Dry-run — rows that would be deleted/cleared', before)

    if (!apply) {
      console.log('\nNo writes performed. Re-run with --apply to execute.')
      return
    }

    // Order matters: delete child rows first so FKs do not abort the tx.
    // The soulAsset.updateMany clears the collection FK so SoulCollectionAsset
    // can drop without leaving orphaned references; SoulAsset rows are then
    // dropped, and finally the SoulCollectionAsset rows.
    await prisma.$transaction([
      prisma.contentAccessRecord.deleteMany({}),
      prisma.soulSkillVersionRecord.deleteMany({}),
      prisma.soulMemoryEntry.deleteMany({}),
      prisma.soulGrantRecord.deleteMany({}),
      prisma.soulAssetVersionRecord.deleteMany({}),
      prisma.bookmark.deleteMany({}),
      prisma.soulPreparedPurchase.deleteMany({}),
      prisma.soulUploadBinding.deleteMany({}),
      prisma.soulTxSync.deleteMany({}),
      prisma.desktopCatalogEntry.deleteMany({ where: { sourceType: 'soul' } }),
      prisma.desktopProfile.updateMany({
        where: { activeSourceType: 'soul' },
        data: { activeSourceType: null, activeSourceRef: null },
      }),
      prisma.soulAsset.updateMany({ data: { collectionOnChainId: null } }),
      prisma.soulAsset.deleteMany({}),
      prisma.soulCollectionAsset.deleteMany({}),
    ])

    const after = await collectCounts(prisma)
    printCounts('\nPost-reset row counts', after)

    const residual =
      after.contentAccessRecord +
      after.soulSkillVersionRecord +
      after.soulMemoryEntry +
      after.soulGrantRecord +
      after.soulAssetVersionRecord +
      after.bookmark +
      after.soulPreparedPurchase +
      after.soulUploadBinding +
      after.soulTxSync +
      after.desktopCatalogSoulEntry +
      after.desktopProfileWithActiveSoul +
      after.soulAsset +
      after.soulCollectionAsset
    if (residual > 0) {
      console.error('\nReset finished but residual rows remain. Investigate before proceeding.')
      process.exitCode = 1
    } else {
      console.log('\nSoulidity mirror cleared. Identity, news, community, starter persona, and desktop sessions preserved.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
