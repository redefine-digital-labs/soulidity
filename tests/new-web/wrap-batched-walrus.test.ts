import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('Wrap uses the shared JOINED controller and has no old paid uploader, mirror or plaintext recovery', () => {
  const source = readFileSync('web/lib/hooks/use-wrap-publish.ts', 'utf8')
  expect(source).toContain("useSingleSoulAuthoring(approve, 'JOINED')")
  for (const obsolete of ['prepareSoulBlobsForBatchPublish', 'fetch(', 'sessionStorage', 'PendingSealMaterial', 'buildPersonalJoinSoulTx'])
    expect(source).not.toContain(obsolete)
})
