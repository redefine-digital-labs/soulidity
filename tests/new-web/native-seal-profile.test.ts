import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { NATIVE_SEAL_ENCRYPTION_PROFILE as PROFILE, assertNativeSealEncryptionProfile } from '../../web/lib/animacraft/native-seal-profile'

// CI verifies the exact peer revision first; local paired runs set an explicit root.
const animacraft = resolve(process.env.ANIMACRAFT_WORKSPACE ?? '_paired/animacraft')
const importFile = (path: string): Promise<any> => import(/* @vite-ignore */ pathToFileURL(path).href)

describe('fresh shared Seal profile', () => {
  it('matches the producer and Move initializer exactly and rejects unsupported metadata', async () => {
    const producer = await importFile(`${animacraft}/maker-v8-seal-profile.js`)
    expect(PROFILE).toEqual(producer.MAKER_V8_SEAL_ENCRYPTION_PROFILE)
    const move = await readFile(`${animacraft}/move/animacraft_v8_seal/sources/seal_v8.move`, 'utf8')
    const names = { cipherSuite: 'CIPHER_SUITE', keyDerivation: 'KEY_DERIVATION', ciphertextFormat: 'CIPHERTEXT_FORMAT' }
    for (const [key, name] of Object.entries(names)) {
      expect(move.match(new RegExp(`const ${name}: vector<u8> = b"([^"]+)";`))?.[1]).toBe(PROFILE[key as keyof typeof PROFILE])
      expect(() => assertNativeSealEncryptionProfile({ ...PROFILE, [key]: 'unsupported' })).toThrow('Unsupported Seal encryption profile')
    }
    expect(assertNativeSealEncryptionProfile(PROFILE)).toEqual(PROFILE)
    expect(() => assertNativeSealEncryptionProfile(undefined)).toThrow('Unsupported Seal encryption profile')
  })

  it('decrypts actual producer SDK ciphertext with the installed reader SDK, including H2/H3 derivation', async () => {
    // Offline, ephemeral key material. No wallet signature or key-server request.
    // Internal crypto modules are test-only to exercise both installed versions.
    const producerPath = `${animacraft}/node_modules/@mysten/seal/dist`
    const readerPath = `${process.cwd()}/web/node_modules/@mysten/seal/dist`
    const [enc, producerDem, producerBls, readerBls, readerKdf, readerBcs, readerDec, producerProfile] = await Promise.all([
      importFile(`${producerPath}/encrypt.mjs`), importFile(`${producerPath}/dem.mjs`),
      importFile(`${producerPath}/bls12381.mjs`), importFile(`${readerPath}/bls12381.mjs`),
      importFile(`${readerPath}/kdf.mjs`), importFile(`${readerPath}/bcs.mjs`),
      importFile(`${readerPath}/decrypt.mjs`), importFile(`${animacraft}/maker-v8-seal-profile.js`),
    ])
    expect(producerProfile.MAKER_V8_SEAL_KEM_TYPE).toBe(enc.KemType.BonehFranklinBLS12381DemCCA)
    const scalar = producerBls.Scalar.random()
    const publicKey = producerBls.G2Element.generator().multiply(scalar).toBytes()
    const packageId = `0x${'01'.repeat(32)}`
    const id = 'ab'.repeat(32)
    const serverId = `0x${'02'.repeat(32)}`
    const plaintext = new TextEncoder().encode('native Complete PNG transport: offline interoperability')
    const aad = new TextEncoder().encode('exact certified identity')
    const result = await enc.encrypt({
      keyServers: [{ objectId: serverId, pk: publicKey }], kemType: producerProfile.MAKER_V8_SEAL_KEM_TYPE,
      threshold: 1, packageId, id, encryptionInput: new producerDem.AesGcm256(plaintext, aad),
    })
    const parsed = readerBcs.EncryptedObject.parse(result.encryptedObject)
    expect(readerBcs.EncryptedObject.serialize(parsed).toBytes()).toEqual(result.encryptedObject)
    expect(parsed.version).toBe(0)
    expect(parsed.ciphertext.$kind).toBe('Aes256Gcm')
    const fullId = packageId.slice(2) + id
    const key = readerKdf.hashToG1(Uint8Array.from(Buffer.from(fullId, 'hex')))
      .multiply(readerBls.Scalar.fromBytes(scalar.toBytes()))
    const decrypted = await readerDec.decrypt({ encryptedObject: parsed,
      keys: new Map([[`${fullId}:${serverId}`, key]]),
      publicKeys: [readerBls.G2Element.fromBytes(publicKey)],
    })
    expect(decrypted).toEqual(plaintext)
    parsed.ciphertext.Aes256Gcm.aad[0] ^= 1
    await expect(readerDec.decrypt({ encryptedObject: parsed, keys: new Map([[`${fullId}:${serverId}`, key]]) })).rejects.toThrow()
  })
})
