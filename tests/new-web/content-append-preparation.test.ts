import { afterEach, expect, it, vi } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils'
import { bcs } from '@mysten/sui/bcs'
import { EncryptedObject, SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { contentAppendPreparedEnvelope, prepareContentAppend, verifyContentAppendPreparation,
  unlockContentAppendPreparation } from '../../web/lib/soulidity/content-append-preparation'
import { decodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => vi.restoreAllMocks())
import { contentAppendPreparationFixture as fixture } from './fixtures/content-append-preparation'
it.each([false, true])('prepares real AES/Seal, signs exact public commitments, then cold verifies/unlocks (empty=%s)', async empty => {
  const f = await fixture(empty), r = await prepareContentAppend(f.params)
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.decryptCall).not.toHaveBeenCalled()
  expect(r.ciphertext.length).toBe(f.params.plaintext.length + 16)
  expect(r.sidecar.sealPackageId).toBe(id(1))
  for (const encrypted of [r.sidecar.encryptedDek, r.recovery.encrypted]) {
    expect(EncryptedObject.parse(fromBase64(encrypted)).packageId).toBe(id(1))
  }
  const cold = await verifyContentAppendPreparation(structuredClone(r), f.client)
  expect(cold.scope.versionIndex).toBe('9007199254740993')
  expect(JSON.stringify(r)).not.toContain('private memory:')
  expect(Object.keys(r)).not.toContain('dek')
  const envelope = contentAppendPreparedEnvelope(r, id(90))
  expect(decodeContentEnvelope(new TextDecoder().decode(envelope), { contentObjectId: id(4), kind: 1,
    name: 'default', versionIndex: '9007199254740993', blobObjectId: id(90) }, id(1)).sidecar).toEqual(r.sidecar)
  const unlocked = await unlockContentAppendPreparation(cold, f.params.wallet)
  const [{ sessionKey, txBytes }] = f.decryptCall.mock.calls[0]
  expect(sessionKey.getPackageId()).toBe(id(1))
  expect(bcs.TransactionKind.parse(txBytes).ProgrammableTransaction!.commands[0].MoveCall)
    .toMatchObject({ package: id(10), module: 'content', function: 'seal_approve_upload_recovery' })
  expect(unlocked.plaintext).toEqual(f.params.plaintext); expect(unlocked.dek).toHaveLength(32)
  expect(f.sign).toHaveBeenCalledTimes(2)
  expect(f.unwrapped.every(bytes => bytes.every(v => v === 0))).toBe(true)
  unlocked.dek.fill(0); unlocked.plaintext.fill(0)
})
it.each(['scope', 'payload', 'primary', 'recovery', 'author', 'signature', 'topology', 'raw-key'])(
  'rejects tampered %s before any cold signature/decryption', async variant => {
    const f = await fixture(), r = structuredClone(await prepareContentAppend(f.params))
    if (variant === 'scope') r.scope.intentJson = '{"operation":"delete"}'
    if (variant === 'payload') r.ciphertext[0] ^= 1
    if (variant === 'primary') r.sidecar.fileName = 'other.md'
    if (variant === 'recovery') r.recovery.encrypted = r.sidecar.encryptedDek
    if (variant === 'author') r.scope.author = id(2)
    if (variant === 'signature') r.authorSignature = (await Ed25519Keypair.generate().signPersonalMessage(new Uint8Array([1]))).signature
    if (variant === 'topology') r.sealConfig.serverConfigs[0].aggregatorUrl = 'https://other.example.com/'
    if (variant === 'raw-key') Object.assign(r, { dek: 'PRIVATE' })
    await expect(unlockContentAppendPreparation(r, f.params.wallet)).rejects.toThrow()
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.decryptCall).not.toHaveBeenCalled()
  },
)
it('a wrong wallet preparation signature is never accepted', async () => {
  const f = await fixture()
  f.sign.mockImplementation(async message => (await Ed25519Keypair.generate().signPersonalMessage(message)).signature)
  await expect(prepareContentAppend(f.params)).rejects.toThrow()
})
it('rejects a signature returned after the wallet changes', async () => {
  const f = await fixture()
  f.sign.mockImplementation(async message => { f.setAddress(null); return (await f.signer.signPersonalMessage(message)).signature })
  await expect(prepareContentAppend(f.params)).rejects.toThrow('WALLET_CHANGED')
})
it('does not sign on a mismatched Seal network', async () => {
  const f = await fixture()
  vi.mocked(f.client.core.getChainIdentifier).mockResolvedValue({ chainIdentifier: 'different' })
  await expect(prepareContentAppend(f.params)).rejects.toThrow('SEAL_NETWORK_MISMATCH')
  expect(f.sign).not.toHaveBeenCalled()
})
it('rejects a malformed future u64/name before key-server or signature work', async () => {
  const f = await fixture()
  for (const [name, versionIndex] of [['default', '18446744073709551616'], ['UPPER', '1'], ['default', '01'], ['other', '0'], ['a/b', '0']]) {
    await expect(prepareContentAppend({ ...f.params, scope: { ...f.params.scope, name, versionIndex } })).rejects.toThrow('SLOT_INVALID')
  }
  expect(f.sign).not.toHaveBeenCalled()
})
it('refuses plaintext/secret API-key Seal configuration', async () => {
  const f = await fixture()
  Object.assign(f.params.sealConfig.serverConfigs[0], { apiKey: 'PRIVATE' })
  await expect(prepareContentAppend(f.params)).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled()
})
it('does not accept a bytes-valid but wrong recovery source hash', async () => {
  const f = await fixture(), r = await prepareContentAppend(f.params)
  const original = f.decryptCall.getMockImplementation()!
  f.decryptCall.mockImplementation(async args => {
    const raw = await original(args), parsed = JSON.parse(new TextDecoder().decode(raw))
    raw.fill(0); parsed.dek = toBase64(new Uint8Array(32).fill(99))
    return new TextEncoder().encode(JSON.stringify(parsed))
  })
  await expect(unlockContentAppendPreparation(r, f.params.wallet)).rejects.toThrow()
})
