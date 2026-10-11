import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromHex, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { generateContentDocumentIdHex } from '@soulidity/sdk'
import { EncryptedObject, SealClient } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { G2Element } from '../../../web/node_modules/@mysten/seal/dist/bls12381.mjs'
import { createFullId } from '../../../web/node_modules/@mysten/seal/dist/utils.mjs'
import { decrypt } from '../../../web/node_modules/@mysten/seal/dist/decrypt.mjs'
import { hashToG1 } from '../../../web/node_modules/@mysten/seal/dist/kdf.mjs'
import { coreClientResolveTransactionPlugin } from '../../../web/node_modules/@mysten/sui/dist/client/core-resolver.mjs'
import { openBrowserSoulContent, type BrowserContentSealConfig } from '../../../web/lib/soulidity/browser-content-open'
import type { BrowserContentAccess, BrowserContentAccessConfig } from '../../../web/lib/soulidity/browser-content-access'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
type OpenParams = Parameters<typeof openBrowserSoulContent>[0]

/** Test-bundle only. Raw authority and key-server transport are controlled;
 * production opener, transaction resolver, SessionKey signature verification,
 * Seal BLS unwrap, AES-GCM and hash verification all run unchanged. Never import
 * this fixture from the app. Dispose its scoped prototype overrides after use. */
export async function createContentBrowserCrypto(options: { emptyMemory?: boolean } = {}) {
  const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  const account = { address: keypair.toSuiAddress() }
  const stats = { opens: 0, reads: 0, rechecks: 0, signatures: 0, decryptions: 0,
    fetches: 0, completed: 0, denied: 0, lastStatus: 'ready', lastKind: -1 }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://controlled-grpc.example.com' })
  Object.defineProperty(client, 'grpc', { value: client, configurable: true })
  client.core.getObject = async () => ({ object: { version: '1' } }) as any
  client.core.getChainIdentifier = async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  client.core.resolveTransactionPlugin = () => coreClientResolveTransactionPlugin
  const ref = (type: string, module: string) => ({ body: { datatype: { package: id(1), module, type, typeParameters: [] } }, reference: 'immutable' })
  client.core.getMoveFunction = async () => ({ function: { parameters: [
    { body: { vector: 'u8' }, reference: null }, ref('SoulState', 'soul'), ref('SoulContent', 'content'),
    { body: 'u32', reference: null }, ref('String', 'string'), { body: 'u64', reference: null },
  ] } }) as any
  client.core.getObjects = async args => ({ objects: args.objectIds.map(objectId => ({ objectId,
    version: '4', digest: toBase58(new Uint8Array(32).fill(3)), owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
  })) }) as any
  const sealConfig: BrowserContentSealConfig = { threshold: 1, ttlMin: 10,
    serverConfigs: [{ objectId: id(50), weight: 1, aggregatorUrl: 'https://controlled-seal.example.com/' }] }
  const config = { target: { soulidityOriginalPackageId: id(1), soulidityCallablePackageId: id(84) },
    kindRegistryId: id(30), storage: { blobType: `${id(90)}::blob::Blob`, aggregatorUrl: 'https://controlled-walrus.example.com' },
  } as BrowserContentAccessConfig
  const keys = sealConfig.serverConfigs.map(s => ({ objectId: s.objectId, name: 'controlled-local', url: s.aggregatorUrl,
    keyType: 0, serverType: 'Independent', pk: G2Element.generator().toBytes() }))
  const originalKeys = SealClient.prototype.getKeyServers, originalDecrypt = SealClient.prototype.decrypt
  const entries = new Map<number, { access: BrowserContentAccess; ciphertext: Uint8Array }>()
  const authorizedDocuments = new Set<string>()
  const plaintext = { soul: '# Controlled Soul\n\nPrivate Soul document decrypted with real Seal and AES.',
    memory: options.emptyMemory ? '' : 'Private memory decrypted with real Seal and AES.' }
  let transaction: ReturnType<typeof bcs.TransactionKind.parse> | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    SealClient.prototype.getKeyServers = originalKeys
    SealClient.prototype.decrypt = originalDecrypt
  }
  SealClient.prototype.getKeyServers = async () => new Map(keys.map(k => [k.objectId, k])) as any
  SealClient.prototype.decrypt = async args => {
    if (disposed || args.checkShareConsistency !== true || (await args.sessionKey.getCertificate()).user !== account.address)
      throw new Error('Controlled content key authorization rejected')
    const parsed = EncryptedObject.parse(args.data)
    if (!authorizedDocuments.has(parsed.id) && ![...entries.values()].some(e => e.access.sealSidecar.documentId.replace(/^0x/, '') === parsed.id))
      throw new Error('Unknown controlled content key')
    stats.decryptions++
    transaction = bcs.TransactionKind.parse(args.txBytes)
    const fullId = createFullId(parsed.packageId, parsed.id)
    return decrypt({ encryptedObject: parsed,
      keys: new Map(keys.map(k => [`${fullId}:${k.objectId}`, hashToG1(fromHex(fullId))])),
      publicKeys: parsed.services.map(() => G2Element.generator()), checkLEEncoding: false })
  }
  try {
    for (const kind of [0, 1]) {
      const name = kind === 0 ? 'soul' : 'default', plain = new TextEncoder().encode(kind === 0 ? plaintext.soul : plaintext.memory)
      const hash = toHex(sha256(plain)), dek = new Uint8Array(32).fill(9 + kind), iv = new Uint8Array(12).fill(7 + kind)
      const aes = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt'])
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain))
      const documentId = generateContentDocumentIdHex({ contentObjectId: id(17), kind, name, versionIndex: 0n, nonce: new Uint8Array(16).fill(1 + kind) })
      const material = new Uint8Array([...dek, ...fromHex(hash)])
      const seal = new SealClient({ suiClient: client, serverConfigs: sealConfig.serverConfigs, verifyKeyServers: true })
      const wrapped = await seal.encrypt({ threshold: 1, packageId: id(1), id: documentId, data: material })
      wrapped.key.fill(0); material.fill(0); dek.fill(0); plain.fill(0)
      const access: BrowserContentAccess = { visibility: 'sealed', soulId: id(3), stateId: id(2), contentId: id(17), kind,
        kindName: kind === 0 ? 'soul_doc' : 'memory', name, versionIndex: '0', owner: account.address, ownershipEpoch: '2',
        viewerAddress: account.address, accessKind: 'owner',
        slot: { readModeMask: '3', opMask: kind === 0 ? '0' : '7', grantScopeMask: kind === 0 ? '1' : '2', downloadPolicy: 'public' },
        artifact: { walrusBlobUrl: `https://controlled-walrus.example.com/v1/blobs/content-${kind}`, walrusBlobId: `content-${kind}`,
          blobObjectId: id(22 + kind), byteLength: String(ciphertext.length), endEpoch: 10 },
        accessPolicy: { packageId: id(1), sealPackageId: id(1), callablePackageId: id(84), stateObjectId: id(2), contentObjectId: id(17),
          kind, name, versionIndex: '0', moduleName: 'content', functionName: 'seal_approve_content_owner',
          soulGrantObjectId: null, paidAccessListOnChainId: null, documentIdHex: documentId },
        sealSidecar: { version: 1, mode: 'seal-envelope', cipher: 'AES-GCM-256', sealPackageId: id(1), documentId,
          encryptedDek: toBase64(wrapped.encryptedObject), iv: toBase64(iv), contentHash: hash,
          fileName: kind === 0 ? 'soul.md' : 'memory.txt', mimeType: 'text/plain' } }
      entries.set(kind, { access, ciphertext })
    }
  } catch (error) { dispose(); throw error }
  const wallet = { signPersonalMessage: async ({ message }: { message: Uint8Array }) => {
    stats.signatures++; return keypair.signPersonalMessage(message)
  } }
  const signPersonalMessage = async (message: Uint8Array) => (await wallet.signPersonalMessage({ message })).signature
  const open = async (params: OpenParams) => {
    stats.opens++; stats.lastKind = params.request.kind; stats.lastStatus = 'opening'
    try {
      const result = await openBrowserSoulContent(params, {
        read: async request => {
          stats.reads++
          const authorize = () => {
            if (disposed || request.viewerAddress !== account.address) {
              stats.denied++; throw new Error('BROWSER_CONTENT_UNAUTHORIZED')
            }
          }
          authorize()
          const entry = entries.get(request.kind)
          if (!entry || request.soulId !== id(3) || request.stateId !== id(2) || request.contentId !== id(17)
            || request.name !== entry.access.name || String(request.versionIndex) !== '0') throw new Error('Controlled content identity mismatch')
          return { access: structuredClone(entry.access), recheck: async () => { stats.rechecks++; authorize() } }
        },
        fetcher: async url => {
          stats.fetches++
          const entry = [...entries.values()].find(e => e.access.artifact.walrusBlobUrl === String(url))
          if (!entry) throw new Error('Unknown controlled content blob')
          return new Response(new Uint8Array(entry.ciphertext))
        },
      })
      stats.completed++; stats.lastStatus = 'decrypted'; return result
    } catch (error) { stats.lastStatus = error instanceof Error ? error.message : String(error); throw error }
  }
  return { account, ownerAddress: account.address, wallet, client: client as SuiGrpcClient & { grpc: SuiGrpcClient },
    config, sealConfig, open, stats, plaintext, dispose, signPersonalMessage, transaction: () => transaction,
    authorizeDocument: (documentId: string) => authorizedDocuments.add(documentId.replace(/^0x/, '')) }
}
