import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const TEN_MINUTES_MS = '10 * 60 * 1000'

function read(relativePath: string): string {
  return readFileSync(`${repoRoot}/${relativePath}`, 'utf8')
}

describe('DigitalOcean Walrus uploader timeout defaults', () => {
  it('allows at least ten minutes for managed uploader tokens and storage-node writes', () => {
    const uploadTokenRoute = read('web/app/api/walrus/upload-token/route.ts')
    const uploaderHandler = read('services/walrus-uploader/src/handler.ts')
    const uploaderServer = read('services/walrus-uploader/src/server.ts')

    expect(uploadTokenRoute).toContain(`const DEFAULT_TOKEN_TTL_MS = ${TEN_MINUTES_MS}`)
    expect(uploaderHandler).toContain(`const WALRUS_STORAGE_WRITE_TIMEOUT_MS = ${TEN_MINUTES_MS}`)
    expect(uploaderServer).toContain(`const WALRUS_STORAGE_NODE_REQUEST_TIMEOUT_MS = ${TEN_MINUTES_MS}`)
  })
})
