import { expect, it } from 'vitest'
import { createContentBrowserCrypto } from './fixtures/content-browser-crypto'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
it.each([false, true])('browser fixture runs real content crypto, empty memory=%s', async emptyMemory => {
  const f = await createContentBrowserCrypto({ emptyMemory })
  try {
    const params = (kind: number, viewerAddress = f.account.address) => ({
      request: { soulId: id(3), stateId: id(2), contentId: id(17), kind, name: kind === 0 ? 'soul' : 'default',
        versionIndex: '0', viewerAddress, config: f.config },
      client: f.client, sealClient: f.client, sealConfig: f.sealConfig, signal: new AbortController().signal,
      getAddress: () => viewerAddress, signPersonalMessage: f.signPersonalMessage,
    })
    for (const kind of [0, 1]) {
      const result = await f.open(params(kind))
      expect(new TextDecoder().decode(result.bytes)).toBe(kind === 0 ? f.plaintext.soul : f.plaintext.memory)
      result.bytes.fill(0)
    }
    expect(f.stats).toMatchObject({ completed: 2, decryptions: 2, signatures: 2, rechecks: 8 })
    expect(f.transaction()?.ProgrammableTransaction.commands[0].MoveCall).toMatchObject({ package: id(84), function: 'seal_approve_content_owner' })
    await expect(f.open(params(0, id(99)))).rejects.toThrow('BROWSER_CONTENT_UNAUTHORIZED')
    expect(f.stats).toMatchObject({ denied: 1, decryptions: 2, signatures: 2 })
  } finally { f.dispose() }
})
