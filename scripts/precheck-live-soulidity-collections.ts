import './lib/dotenv'

import { PrismaPg } from '@prisma/adapter-pg'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { createSuiGrpcCompatClient } from '@soulidity/sdk'

import { PrismaClient } from '../src/db/prisma-client.js'

// Mandatory pre-flight before re-publishing the Soulidity package on a live
// network. Refuses to proceed if any of these signals indicate that real
// SoulCollection state already exists for the supplied package:
//
//   1. Production DB has any `SoulCollectionAsset` rows (the mirror).
//   2. Sui has emitted any original-package collection events.
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
//       --original-package-id=<original-mainnet-package-id> \
//       --database-url=$DATABASE_URL \
//       --owner=<deployer> --owner=<multisig>

interface CliOptions {
  originalPackageId: string
  databaseUrl: string
  owners: string[]
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
}

const SUI_GRAPHQL_URL = {
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
  devnet: 'https://graphql.devnet.sui.io/graphql',
} as const

type CollectionEventsQuery = {
  events: {
    nodes: Array<{ contents: { json: unknown } | null }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

function parseArgs(argv: string[]): CliOptions {
  let originalPackageId = ''
  let databaseUrl = process.env.DATABASE_URL ?? ''
  const owners: string[] = []
  let network: CliOptions['network'] =
    (process.env.NEXT_PUBLIC_SUI_NETWORK as CliOptions['network']) ?? 'mainnet'

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--original-package-id=')) {
      originalPackageId = arg.slice('--original-package-id='.length)
    } else if (arg.startsWith('--package-id=')) {
      console.error('--package-id is ambiguous after upgrades; use --original-package-id')
      process.exit(1)
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

  if (!originalPackageId) {
    console.error('Missing required --original-package-id')
    printUsage()
    process.exit(1)
  }
  if (!databaseUrl) {
    console.error('Missing required --database-url (or set DATABASE_URL)')
    printUsage()
    process.exit(1)
  }

  return { originalPackageId, databaseUrl, owners, network }
}

function printUsage() {
  console.log(`Usage: npx tsx scripts/precheck-live-soulidity-collections.ts [options]

Required:
  --original-package-id=<id>
                          Original Soulidity package defining collection types/events
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

async function checkSuiEvents(client: SuiGraphQLClient, packageId: string) {
  const findings: { eventType: string; count: number; sampleIds: string[] }[] = []
  for (const moduleEvent of [
    `${packageId}::collection::SoulCollectionCreated`,
    `${packageId}::market::CollectionMintedToKiosk`,
  ]) {
    const sampleIds: string[] = []
    let cursor: string | null = null
    let total = 0
    // Page until we either prove non-empty (one page is enough) or cleanly
    // exhaust the stream. Hard cap at 5 pages so we never spin forever.
    for (let page = 0; page < 5; page++) {
      const res = await client.query<
        CollectionEventsQuery,
        { type: string; after: string | null }
      >({
        query: `
          query SoulidityCollectionEvents($type: String!, $after: String) {
            events(first: 50, after: $after, filter: { type: $type }) {
              nodes { contents { json } }
              pageInfo { hasNextPage endCursor }
            }
          }
        `,
        variables: { type: moduleEvent, after: cursor },
      })
      if (res.errors?.length || !res.data) {
        throw new Error(
          `Sui GraphQL event query failed for ${moduleEvent}: ${JSON.stringify(res.errors ?? [])}`,
        )
      }
      total += res.data.events.nodes.length
      for (const ev of res.data.events.nodes) {
        const parsed = ev.contents?.json as { collection_id?: string } | undefined
        if (parsed?.collection_id && sampleIds.length < 5) {
          sampleIds.push(parsed.collection_id)
        }
      }
      if (!res.data.events.pageInfo.hasNextPage || total >= 50) break
      cursor = res.data.events.pageInfo.endCursor
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

  if (opts.network === 'localnet') {
    throw new Error('Live collection precheck does not support localnet')
  }
  const client = createSuiGrpcCompatClient(opts.network)
  const graphqlClient = new SuiGraphQLClient({
    url: process.env.SUI_GRAPHQL_URL?.trim() || SUI_GRAPHQL_URL[opts.network],
    network: opts.network,
  })

  console.error(`[precheck] network=${opts.network} originalPackage=${opts.originalPackageId}`)

  const [db, events, owned] = await Promise.all([
    checkDatabase(opts.databaseUrl),
    checkSuiEvents(graphqlClient, opts.originalPackageId),
    checkOwnedRights(client, opts.originalPackageId, opts.owners),
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
