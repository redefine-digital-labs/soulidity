export {}

async function main() {
  const { runIndexer } = await import('../../web/lib/services/sui-indexer')

  if (typeof runIndexer !== 'function') {
    throw new Error('runIndexer export not found in ../../web/lib/services/sui-indexer')
  }

  await runIndexer()
}

main().catch((err) => {
  console.error('Indexer fatal error:', err)
  process.exit(1)
})
