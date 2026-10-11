import { it, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { createBrowserSoulDetailModel } from './fixtures/browser-soul-detail-fixture'

it('exports the raw-reader detail model for the local content browser journey', async () => {
  const owner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)).toSuiAddress()
  const model = (await createBrowserSoulDetailModel(false, owner)).compose()
  expect(model.currentOwnerAddress).toBe(owner)
  expect(model.isOwner).toBe(true)
  if (process.env.S3_CONTENT_BROWSER_DIR) await writeFile(path.join(process.env.S3_CONTENT_BROWSER_DIR, 'detail.json'), JSON.stringify(model))
})
