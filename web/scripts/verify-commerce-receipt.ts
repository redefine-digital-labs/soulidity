import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createNativeReceiveClient } from '../lib/animacraft/native-receive'
import { replayCommerceAcceptance } from '../lib/soulidity/commerce/public-acceptance-replay'

const USAGE = 'Usage: tsx web/scripts/verify-commerce-receipt.ts <expected-case.json> <retained-purchase-original.json>'

async function readInput(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) throw new Error('Input must be a bounded, nonempty regular file')
    const buffer = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== stat.size) throw new Error('Input changed while reading')
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(USAGE + '\n')
    return
  }
  if (args.length !== 2) throw new Error(USAGE)
  const [expected, original] = await Promise.all([readInput(args[0], 8192), readInput(args[1], 3 * 1024 * 1024)])
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const signal = AbortSignal.timeout(90_000)
  const report = await replayCommerceAcceptance(JSON.parse(decoder.decode(expected)), {
    client: createNativeReceiveClient(signal), signal, originalText: decoder.decode(original),
  })
  process.stdout.write(JSON.stringify({ ...report, originalSha256: createHash('sha256').update(original).digest('hex') }, null, 2) + '\n')
  if (report.status !== 'ORIGINAL_SETTLEMENT_PROVED') process.exitCode = 2
}

main(process.argv.slice(2)).catch(error => {
  // JSON parse errors can include excerpts of the original. Never print them.
  const message = error instanceof SyntaxError ? 'Invalid JSON input'
    : error instanceof Error ? error.message : 'Receipt verification failed'
  process.stderr.write(message + '\n')
  process.exitCode = 1
})
