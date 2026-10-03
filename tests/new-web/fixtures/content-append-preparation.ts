import { expect, vi } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromHex } from '@mysten/sui/utils'
import { EncryptedObject, SealClient } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
export const contentAppendFixtureId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const id = contentAppendFixtureId
export async function contentAppendPreparationFixture(empty = false) {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)), controller = new AbortController()
  let address: string | null = signer.toSuiAddress()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://sui.example.com' })
  vi.spyOn(client.core, 'getObject').mockResolvedValue({ object: { version: '1' } } as any)
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  const resolver = await import('../../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs')
  vi.spyOn(client.core, 'resolveTransactionPlugin').mockReturnValue(resolver.coreClientResolveTransactionPlugin)
  vi.spyOn(client.core, 'getMoveFunction').mockResolvedValue({ function: { parameters: [{ body: { vector: 'u8' }, reference: null }] } } as any)
  const paths = ['bls12381', 'utils', 'decrypt', 'kdf'].map(n => `../../../web/node_modules/@mysten/seal/dist/${n}.mjs`)
  const [bls, utils, decrypt, kdf] = await Promise.all(paths.map(p => import(p)))
  const servers = [{ objectId: id(50), weight: 1, aggregatorUrl: 'https://seal.example.com/' }]
  const keys = servers.map(s => ({ objectId: s.objectId, name: 'local', url: s.aggregatorUrl, keyType: 0,
    serverType: 'Independent', pk: bls.G2Element.generator().toBytes() }))
  vi.spyOn(SealClient.prototype, 'getKeyServers').mockResolvedValue(new Map(keys.map(k => [k.objectId, k])) as any)
  const unwrapped: Uint8Array[] = []
  const decryptCall = vi.spyOn(SealClient.prototype, 'decrypt').mockImplementation(async args => {
    expect(args.checkShareConsistency).toBe(true)
    expect((await args.sessionKey.getCertificate()).user).toBe(signer.toSuiAddress())
    const parsed = EncryptedObject.parse(args.data), fullId = utils.createFullId(parsed.packageId, parsed.id)
    const bytes = await decrypt.decrypt({ encryptedObject: parsed,
      keys: new Map(keys.map(k => [`${fullId}:${k.objectId}`, kdf.hashToG1(fromHex(fullId))])),
      publicKeys: parsed.services.map(() => bls.G2Element.generator()), checkLEEncoding: false })
    unwrapped.push(bytes); return bytes
  })
  const sign = vi.fn(async (message: Uint8Array) => (await signer.signPersonalMessage(message)).signature)
  const plaintext = new TextEncoder().encode(empty ? '' : 'private memory: not in any public recovery journal')
  const params = { scope: { author: signer.toSuiAddress(), originalPackageId: id(1), callablePackageId: id(10),
    contentObjectId: id(4), kind: 1, name: 'default', versionIndex: '9007199254740993', intentJson: '{"operation":"append"}' },
  sealConfig: { threshold: 1, ttlMin: 5, serverConfigs: servers }, plaintext, mimeType: 'text/plain', fileName: 'memory.md',
  wallet: { client, sealClient: client, signal: controller.signal, getAddress: () => address, signPersonalMessage: sign } }
  return { params, client, signer, sign, decryptCall, unwrapped, controller, setAddress: (v: string | null) => { address = v } }
}
