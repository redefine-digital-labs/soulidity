import { vi } from 'vitest'
import { EncryptedObject, SealClient } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { fromHex } from '@mysten/sui/utils'
import { emptyPrivateBookmarkLibrary, preparePrivateBookmarkMutation } from '../../../web/lib/bookmarks/private-bookmark-library'
import { encryptPrivateBookmarkLibrary, decryptPrivateBookmarkLibrary } from '../../../web/lib/bookmarks/private-bookmark-crypto'

export const bid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const bhash = (n: number) => n.toString(16).padStart(64, '0')
/** Actual installed AES + Seal BLS/IBE, with local test master keys. This is not
 * a key-server authorization, a live wallet interaction or a deployed policy. */
export async function bookmarkCryptoFixture(options?: { scope?: { registryId: string; owner: string }; originalPackageId?: string; chainIdentifier?: string }) {
  const names = ['bls12381', 'kdf', 'utils', 'decrypt']
  const modules = await Promise.all(names.map(name => import(`../../../web/node_modules/@mysten/seal/dist/${name}.mjs`)))
  const cryptography = Object.assign({}, ...modules)
  const scope = structuredClone(options?.scope ?? { registryId: bid(1), owner: bid(2) }), soulId = bid(3)
  const library = preparePrivateBookmarkMutation(emptyPrivateBookmarkLibrary(scope), { scope, action: 'set', soulId, bookmarked: true,
    expectedRevision: '0', requestId: bhash(1), at: '2026-09-15T12:00:00.000Z' }).library
  const context = { scope, revision: '1', requestId: bhash(1), originalPackageId: options?.originalPackageId ?? bid(40),
    chainIdentifier: options?.chainIdentifier ?? '35834a8a' }
  const sealConfig = { threshold: 2, ttlMin: 10, serverConfigs: [
    { objectId: bid(700), weight: 2, aggregatorUrl: 'https://key-one.example' },
    { objectId: bid(701), weight: 1, aggregatorUrl: 'https://key-two.example' },
  ] }
  const seal = new SealClient({ suiClient: { core: { getObject: async () => ({ object: { version: '1' } }) } } as any,
    serverConfigs: sealConfig.serverConfigs, verifyKeyServers: true })
  vi.spyOn(seal, 'getKeyServers').mockResolvedValue(new Map(sealConfig.serverConfigs.map(row => [row.objectId, {
    objectId: row.objectId, name: 'local key', url: row.aggregatorUrl, keyType: 0, serverType: 'Independent' as const,
    pk: cryptography.G2Element.generator().toBytes(),
  }])))
  const controller = new AbortController(), verify = vi.fn(async () => {})
  const keys: Uint8Array[] = [], encrypt = seal.encrypt.bind(seal)
  vi.spyOn(seal, 'encrypt').mockImplementation(async args => {
    keys.push(args.data); const result = await encrypt(args); keys.push(result.key); return result
  })
  const unwrap = vi.fn(async (bytes: Uint8Array): Promise<Uint8Array> => {
    const parsed = EncryptedObject.parse(bytes), fullId = cryptography.createFullId(parsed.packageId, parsed.id)
    const secret = cryptography.hashToG1(fromHex(fullId))
    const result = await cryptography.decrypt({ encryptedObject: parsed,
      keys: new Map(sealConfig.serverConfigs.map(row => [`${fullId}:${row.objectId}`, secret])),
      publicKeys: parsed.services.map(() => cryptography.G2Element.generator()), checkLEEncoding: false })
    keys.push(result); return result
  })
  const encryptParams = { library, context, sealConfig, seal, signal: controller.signal, verify }
  const encryptBytes = () => encryptPrivateBookmarkLibrary(encryptParams)
  const decryptBytes = (bytes: Uint8Array) => decryptPrivateBookmarkLibrary({ bytes, context, sealConfig, signal: controller.signal, unwrap, verify })
  return { scope, soulId, library, context, sealConfig, seal, controller, verify, unwrap, keys, encryptParams, encryptBytes, decryptBytes }
}
