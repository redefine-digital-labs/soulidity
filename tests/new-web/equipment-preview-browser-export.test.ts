import { expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { nativeEquipmentRenderFixture, renderId } from './fixtures/native-equipment-render'
import { readNativeEquipment } from '../../web/lib/animacraft/native-equipment'
it('exports real raw-reader scenes and matching public PNG for the original preview', async () => {
  const chunk = (name: string, payload: Buffer) => {
    const content = Buffer.concat([Buffer.from(name), payload]); let crc = 0xffffffff
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(payload.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, content, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6
  const pixels = Buffer.alloc(32 * (1 + 32 * 4))
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) pixels.set([255, 30, 90, 255], y * 129 + 1 + x * 4)
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  const f = nativeEquipmentRenderFixture('base', false, png)
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(f.manifests.get(url.split('/').at(-1)!)!)))
  try {
    const input = { soulId: renderId(12), stateId: renderId(14) }
    const snapshot = await readNativeEquipment(f.client, f.target, input), scene = await f.readScene()
    expect(scene.status).toBe('AVAILABLE')
    f.editLoadout(row => { row.revision = '2'; row.selections = [null, null, null]; row.selection_count = '0' })
    const emptySnapshot = await readNativeEquipment(f.client, f.target, input), emptyScene = await f.readScene()
    expect(emptyScene.status).toBe('EMPTY')
    if (process.env.S8_BROWSER_DIR) {
      await writeFile(path.join(process.env.S8_BROWSER_DIR, 'preview.json'), JSON.stringify({ snapshot, scene, emptySnapshot, emptyScene, mediaBlobId: f.mediaBlobId }))
      await writeFile(path.join(process.env.S8_BROWSER_DIR, 'media.png'), png)
    }
  } finally { vi.unstubAllGlobals() }
})
