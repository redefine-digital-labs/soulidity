import { describe, expect, it, vi, afterEach } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import {
  buildMintAnimacraftV8SoulTx, type MintAnimacraftV8SoulTxParams,
  KIND_SOUL_DOC, KIND_MEMORY, READ_OWNER, READ_GRANT, NO_DOWNLOAD_POLICY,
} from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture(): MintAnimacraftV8SoulTxParams {
  return {
    mintNonce: new Uint8Array(16).fill(1), expectedContentObjectId: id(40),
    integration: {
      soulidityCallablePackageId: id(1), soulidityOriginalPackageId: id(2),
      kioskPackageId: id(3), marketConfigV2Id: id(4), kindRegistryId: id(5),
      kioskRegistryId: id(6), soulTransferPolicyId: id(7), makerRootId: id(8),
      protocolConfigId: id(9), outputRegistryId: id(10), soulRegistryId: id(11),
      paymentCoinType: '0x2::sui::SUI',
      expectedNativeBinding: {
        soulOriginalType: `${id(2)}::soul::Soul`, soulDefiningType: `${id(2)}::soul::Soul`,
        mintWitnessOriginalType: `${id(2)}::animacraft_v8_binding::MintBindingWitnessV8`,
        mintWitnessDefiningType: `${id(12)}::animacraft_v8_binding::MintBindingWitnessV8`,
        ownerWitnessOriginalType: `${id(2)}::animacraft_v8_binding::SoulOwnerWitnessV8`,
        ownerWitnessDefiningType: `${id(12)}::animacraft_v8_binding::SoulOwnerWitnessV8`,
      },
    },
    currentKioskId: id(13), currentKioskCapOnChainId: id(14),
    name: 'Native Soul', description: 'Exact V8 completion',
    initialContent: [
      { kind: KIND_SOUL_DOC, name: 'soul', blobObjectId: id(15), slotReadModeMask: READ_OWNER | READ_GRANT, downloadPolicy: NO_DOWNLOAD_POLICY, setActive: false, expectedVersionIndex: 0, encryptedEnvelope: new Uint8Array([1]) },
      { kind: KIND_MEMORY, name: 'default', blobObjectId: id(16), slotReadModeMask: READ_OWNER | READ_GRANT, downloadPolicy: NO_DOWNLOAD_POLICY, setActive: false, expectedVersionIndex: 0, encryptedEnvelope: new Uint8Array([2]) },
    ],
    initialStateConfig: [],
    createAuthorization: (tx) => tx.moveCall({ target: `${id(17)}::output_v8::complete_output_v8`, arguments: [] }),
  }
}
afterEach(() => vi.unstubAllEnvs())

describe('native V8 Complete builder', () => {
  it('preserves an optional empty description without inventing content', async () => {
    const params = fixture()
    params.description = ''
    const data = (await buildMintAnimacraftV8SoulTx(params)).getData()
    const mint = data.commands.find((c) => c.MoveCall?.function === 'mint_animacraft_v8_in_personal_kiosk')!.MoveCall!
    const descriptionInput = data.inputs[(mint.arguments[12] as { Input: number }).Input]!
    expect(bcs.string().fromBase64(descriptionInput.Pure!.bytes)).toBe('')
  })

  it('uses exact explicit ABI, same-PTB authorization and native finalize with no env', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', 'invalid legacy config')
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', 'invalid legacy config')
    const tx = await buildMintAnimacraftV8SoulTx(fixture())
    const data = tx.getData()
    const calls = data.commands.flatMap((c) => c.MoveCall ? [c.MoveCall] : [])
    const mint = calls.find((c) => c.function === 'mint_animacraft_v8_in_personal_kiosk')!
    expect(mint.package).toBe(id(1))
    expect(mint.typeArguments).toEqual(['0x2::sui::SUI'])
    expect(mint.arguments).toHaveLength(18)
    const pure = (position: number) => data.inputs[(mint.arguments[position] as { Input: number }).Input]!.Pure!.bytes
    expect(bcs.vector(bcs.u8()).fromBase64(pure(15))).toEqual(Array(16).fill(1))
    expect(bcs.Address.fromBase64(pure(16))).toBe(id(40))
    const authorizationIndex = data.commands.findIndex((c) => c.MoveCall?.function === 'complete_output_v8')
    expect(mint.arguments[10]).toMatchObject({ Result: authorizationIndex })
    const mintIndex = data.commands.findIndex((c) => c.MoveCall === mint)
    expect(calls.at(-1)?.function).toBe('finalize_soul_state')
    expect(calls.at(-1)?.arguments[0]).toMatchObject({ Result: mintIndex })
    expect(data.commands.flatMap((c) => c.MakeMoveVec ? [c.MakeMoveVec.type] : []))
      .toEqual([`${id(2)}::market::InitialContentEntry`, `${id(2)}::market::StateConfigEntry`])
    for (const [index, objectId] of [[0, id(4)], [1, id(5)], [2, id(6)], [3, id(7)], [6, id(8)], [7, id(9)], [8, id(10)], [9, id(11)]] as const) {
      const arg = mint.arguments[index] as { Input: number }
      expect(data.inputs[arg.Input]).toMatchObject({ UnresolvedObject: { objectId } })
    }
    expect(calls.some((c) => /mint_canonical|mint_animacraft_v[457]_/.test(c.function))).toBe(false)
  })

  it('creates and finishes a personal Kiosk when absent', async () => {
    const params = fixture()
    delete params.currentKioskId
    delete params.currentKioskCapOnChainId
    const tx = await buildMintAnimacraftV8SoulTx(params)
    const calls = tx.getData().commands.flatMap((c) => c.MoveCall ? [c.MoveCall] : [])
    expect(calls.slice(0, 3).map((c) => c.function)).toEqual(['new', 'new', 'ensure_personal_kiosk_registered_v2'])
    expect(calls.slice(-3).map((c) => c.function)).toEqual(['finalize_soul_state', 'public_share_object', 'transfer_to_sender'])
    expect(calls.at(-1)?.package).toBe(id(3))
  })

  it('supports old Soul, later proof definitions and a still newer callable package', async () => {
    const params = fixture()
    const types = params.integration.expectedNativeBinding
    expect(types.soulDefiningType.startsWith(id(2))).toBe(true)
    expect(types.mintWitnessDefiningType.startsWith(id(12))).toBe(true)
    params.integration.soulidityCallablePackageId = id(30)
    const tx = await buildMintAnimacraftV8SoulTx(params)
    expect(tx.getData().commands.find((c) => c.MoveCall?.function === 'mint_animacraft_v8_in_personal_kiosk')?.MoveCall?.package).toBe(id(30))
  })

  it.each([
    ['mintWitnessOriginalType', `${id(12)}::animacraft_v8_binding::MintBindingWitnessV8`],
    ['ownerWitnessOriginalType', `${id(12)}::animacraft_v8_binding::SoulOwnerWitnessV8`],
    ['ownerWitnessDefiningType', `${id(31)}::animacraft_v8_binding::SoulOwnerWitnessV8`],
    ['soulDefiningType', `${id(2)}::soul::SoulAlias`],
    ['mintWitnessDefiningType', `${id(12)}::wrong_module::MintBindingWitnessV8`],
    ['soulDefiningType', '0x2::soul::Soul'],
    ['mintWitnessDefiningType', `${id(0)}::animacraft_v8_binding::MintBindingWitnessV8`],
  ] as const)('rejects invalid lineage or definition %s %s', async (key, value) => {
    const params = fixture()
    params.integration.expectedNativeBinding[key] = value
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow(/mismatch|canonical nonzero/)
  })

  it.each(['makerRootId', 'protocolConfigId', 'outputRegistryId', 'soulRegistryId', 'soulidityCallablePackageId'] as const)('rejects missing explicit %s before callback, even with env', async (key) => {
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(1))
    const params = fixture()
    params.integration[key] = ''
    const callback = vi.fn(params.createAuthorization)
    params.createAuthorization = callback
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow('canonical nonzero')
    expect(callback).not.toHaveBeenCalled()
  })

  it.each(['soulOriginalType', 'soulDefiningType', 'mintWitnessOriginalType', 'ownerWitnessOriginalType', 'mintWitnessDefiningType', 'ownerWitnessDefiningType'] as const)('rejects mismatched exact %s', async (key) => {
    const params = fixture()
    params.integration.expectedNativeBinding[key] += '<u8>'
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow(/mismatch/)
  })

  it('keeps input snapshot across async authorization', async () => {
    const params = fixture()
    const original = params.createAuthorization
    params.createAuthorization = async (tx) => {
      params.name = 'changed'
      params.integration.makerRootId = id(99)
      params.initialContent[0]!.blobObjectId = id(98)
      params.initialContent[0]!.encryptedEnvelope.fill(255)
      params.mintNonce.fill(255)
      params.expectedContentObjectId = id(99)
      return original(tx)
    }
    const data = (await buildMintAnimacraftV8SoulTx(params)).getData()
    expect(data.inputs.some((i) => i.UnresolvedObject?.objectId === id(8))).toBe(true)
    expect(data.inputs.some((i) => i.UnresolvedObject?.objectId === id(98))).toBe(false)
    const mint = data.commands.find((c) => c.MoveCall?.function === 'mint_animacraft_v8_in_personal_kiosk')!.MoveCall!
    const nameInput = data.inputs[(mint.arguments[11] as { Input: number }).Input]!
    expect(bcs.string().fromBase64(nameInput.Pure!.bytes)).toBe('Native Soul')
    const nonceInput = data.inputs[(mint.arguments[15] as { Input: number }).Input]!
    const expectedIdInput = data.inputs[(mint.arguments[16] as { Input: number }).Input]!
    expect(bcs.vector(bcs.u8()).fromBase64(nonceInput.Pure!.bytes)).toEqual(Array(16).fill(1))
    expect(bcs.Address.fromBase64(expectedIdInput.Pure!.bytes)).toBe(id(40))
    const entry = data.commands.find(c => c.MoveCall?.function === 'new_initial_content_entry')!.MoveCall!
    expect(entry.arguments).toHaveLength(8)
    const envelopeInput = data.inputs[(entry.arguments[7] as { Input: number }).Input]!
    expect(bcs.vector(bcs.u8()).fromBase64(envelopeInput.Pure!.bytes)).toEqual([1])
  })

  it.each(['nonce', 'expectedId', 'envelope', 'version'] as const)('requires initial %s before requesting the native authorization', async field => {
    const params = fixture()
    if (field === 'nonce') params.mintNonce = undefined as never
    if (field === 'expectedId') params.expectedContentObjectId = ''
    if (field === 'envelope') params.initialContent[0]!.encryptedEnvelope = new Uint8Array()
    if (field === 'version') params.initialContent[0]!.expectedVersionIndex = 1
    const callback = vi.fn(params.createAuthorization)
    params.createAuthorization = callback
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })

  it('rejects UTF8 limits, incomplete native content and incomplete kiosk pair', async () => {
    const params = fixture()
    params.name = '界'.repeat(86)
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow('256-byte')
    params.name = 'valid'
    params.initialContent = []
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow('SOUL_DOC')
    const missingCap = fixture()
    delete missingCap.currentKioskCapOnChainId
    await expect(buildMintAnimacraftV8SoulTx(missingCap)).rejects.toThrow('provided together')
  })

  it('rejects object inputs as the one-use authorization', async () => {
    const params = fixture()
    params.createAuthorization = (tx) => tx.object(id(90))
    await expect(buildMintAnimacraftV8SoulTx(params)).rejects.toThrow('Move-call result')
  })
})
