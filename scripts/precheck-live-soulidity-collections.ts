import './lib/dotenv'

import { PrismaPg } from '@prisma/adapter-pg'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { PrismaClient } from '../src/db/prisma-client.js'

// Mandatory pre-flight before re-publishing the Soulidity package on a live
// network. Refuses to proceed if any of these signals indicate that real
// SoulCollection state already exists for the supplied package:
//
//   1. Production DB has any `SoulCollectionAsset` rows (the mirror).
//   2. Sui has emitted any `${packageId}::collection::SoulCollectionCreated`
//      or `${packageId}::market::CollectionMintedToKiosk` events.
//   3. (Optional) Any of the supplied owner addresses holds a
//      `SoulCollectionRight` object — useful as a side-channel signal but
//      NOT a sole authority because `SoulCollection` is a shared object.
//
// Exit codes (idempotent — safe to re-run):
//   0  every signal is empty → publish may proceed.
//   1  any signal non-empty → STOP. Either migrate via package upgrade or
//      formalize a migration plan before continuing.
//
// Usage:
//   NEXT_PUBLIC_SUI_NETWORK=mainnet \
//     npx tsx scripts/precheck-live-soulidity-collections.ts \
//       --package-id=<current-mainnet-package-id> \
//       --database-url=$DATABASE_URL \
//       --owner=<deployer> --owner=<multisig>

interface CliOptions {
  packageId: string
  databaseUrl: string
  owners: string[]
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
}

function parseArgs(argv: string[]): CliOptions {
  let packageId = ''
  let databaseUrl = process.env.DATABASE_URL ?? ''
  const owners: string[] = []
  let network: CliOptions['network'] =
    (process.env.NEXT_PUBLIC_SUI_NETWORK as CliOptions['network']) ?? 'mainnet'

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--package-id=')) {
      packageId = arg.slice('--package-id='.length)
    } else if (arg.startsWith('--database-url=')) {
      databaseUrl = arg.slice('--database-url='.length)
    } else if (arg.startsWith('--owner=')) {
      owners.push(arg.slice('--owner='.length))
    } else if (arg.startsWith('--network=')) {
      network = arg.slice('--network='.length) as CliOptions['network']
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }

  if (!packageId) {
    console.error('Missing required --package-id')
    printUsage()
    process.exit(1)
  }
  if (!databaseUrl) {
    console.error('Missing required --database-url (or set DATABASE_URL)')
    printUsage()
    process.exit(1)
  }

  return { packageId, databaseUrl, owners, network }
}

function printUsage() {
  console.log(`Usage: npx tsx scripts/precheck-live-soulidity-collections.ts [options]

Required:
  --package-id=<id>       Current on-chain Soulidity package ID
  --database-url=<url>    Production DB URL (defaults to DATABASE_URL env var)

Optional:
  --owner=<addr>          (repeatable) deployer / multisig / holder addresses to scan
  --network=<network>     Sui network (defaults to NEXT_PUBLIC_SUI_NETWORK or 'mainnet')

Exit:
  0  every signal empty (publish allowed)
  1  any signal non-empty (publish blocked; see stderr)
`)
}

async function checkDatabase(databaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: databaseUrl })
  const prisma = new PrismaClient({ adapter })
  try {
    const count = await prisma.soulCollectionAsset.count()
    let sample: { onChainId: string; name: string }[] = []
    if (count > 0) {
      sample = await prisma.soulCollectionAsset.findMany({
        select: { onChainId: true, name: true },
        take: 5,
        orderBy: { createdAt: 'asc' },
      })
    }
    return { count, sample }
  } finally {
    await prisma.$disconnect()
  }
}

async function checkSuiEvents(client: SuiJsonRpcClient, packageId: string) {
  const findings: { eventType: string; count: number; sampleIds: string[] }[] = []
  for (const moduleEvent of [
    `${packageId}::collection::SoulCollectionCreated`,
    `${packageId}::market::CollectionMintedToKiosk`,
  ]) {
    const sampleIds: string[] = []
    let cursor: { txDigest: string; eventSeq: string } | null | undefined = null
    let total = 0
    // Page until we either prove non-empty (one page is enough) or cleanly
    // exhaust the stream. Hard cap at 5 pages so we never spin forever.
    for (let page = 0; page < 5; page++) {
      const res = await client.queryEvents({
        query: { MoveEventType: moduleEvent },
        cursor: cursor ?? null,
        limit: 50,
      })
      total += res.data.length
      for (const ev of res.data) {
        const parsed = ev.parsedJson as { collection_id?: string } | undefined
        if (parsed?.collection_id && sampleIds.length < 5) {
          sampleIds.push(parsed.collection_id)
        }
      }
      if (!res.hasNextPage || total >= 50) break
      cursor = res.nextCursor ?? null
    }
    findings.push({ eventType: moduleEvent, count: total, sampleIds })
  }
  return findings
}

async function checkOwnedRights(client: SuiJsonRpcClient, packageId: string, owners: string[]) {
  const findings: { owner: string; count: number; sampleIds: string[] }[] = []
  for (const rawOwner of owners) {
    const owner = normalizeSuiAddress(rawOwner)
    let total = 0
    const sampleIds: string[] = []
    let cursor: string | null | undefined = null
    for (let page = 0; page < 5; page++) {
      const res = await client.getOwnedObjects({
        owner,
        cursor: cursor ?? undefined,
        filter: { StructType: `${packageId}::collection::SoulCollectionRight` },
        options: { showType: true },
      })
      total += res.data.length
      for (const obj of res.data) {
        if (obj.data?.objectId && sampleIds.length < 5) {
          sampleIds.push(obj.data.objectId)
        }
      }
      if (!res.hasNextPage) break
      cursor = res.nextCursor ?? null
    }
    findings.push({ owner, count: total, sampleIds })
  }
  return findings
}

async function main() {
  const opts = parseArgs(process.argv)

  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(opts.network),
    network: opts.network,
  })

  console.error(`[precheck] network=${opts.network} package=${opts.packageId}`)

  const [db, events, owned] = await Promise.all([
    checkDatabase(opts.databaseUrl),
    checkSuiEvents(client, opts.packageId),
    checkOwnedRights(client, opts.packageId, opts.owners),
  ])

  const dbBlocking = db.count > 0
  const eventsBlocking = events.some((f) => f.count > 0)
  const ownedBlocking = owned.some((f) => f.count > 0)
  const blocking = dbBlocking || eventsBlocking || ownedBlocking

  console.error(`[precheck] DB SoulCollectionAsset rows: ${db.count}`)
  if (dbBlocking) {
    console.error(`[precheck] DB sample: ${JSON.stringify(db.sample)}`)
  }
  for (const ev of events) {
    console.error(`[precheck] event ${ev.eventType}: ${ev.count}`)
    if (ev.count > 0) {
      console.error(`[precheck]   sample collection_ids: ${JSON.stringify(ev.sampleIds)}`)
    }
  }
  for (const owner of owned) {
    console.error(`[precheck] owned SoulCollectionRight by ${owner.owner}: ${owner.count}`)
    if (owner.count > 0) {
      console.error(`[precheck]   sample object_ids: ${JSON.stringify(owner.sampleIds)}`)
    }
  }

  if (blocking) {
    console.error('[precheck] FAIL: live Soulidity collection state detected. Aborting publish.')
    console.error('[precheck] Either upgrade the package in place + migrate, or formalize a migration plan before re-publishing.')
    process.exit(1)
  }

  console.error('[precheck] OK: no live Soulidity collection state. Publish may proceed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[precheck] unexpected error', err)
  process.exit(1)
})
