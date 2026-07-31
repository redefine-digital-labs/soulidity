import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  animacraftMintRecoveryContextsMatch,
  normalizeAnimacraftMintRecoveryContext,
  type AnimacraftMintRecoveryContext,
} from '../../web/lib/animacraft/mint-recovery-context'

const PAGE = readFileSync(
  'web/app/integrations/animacraft/page.tsx',
  'utf8',
)
const CLIENT = readFileSync(
  'web/app/integrations/animacraft/integration-client.tsx',
  'utf8',
)
const MINT = readFileSync(
  'web/lib/hooks/use-animacraft-mint.ts',
  'utf8',
)

describe('Animacraft protected Complete callback contract', () => {
  it('keeps the protected final image Blob distinct from its public preview', () => {
    expect(PAGE).toContain('imagePreviewBlobId: first(params.imagePreviewBlob)')
    expect(CLIENT).toContain('handoff.imagePreviewBlobId || handoff.imageBlobId')
    expect(CLIENT).toContain('handoff.imagePreviewBlobId === handoff.imageBlobId')
    expect(CLIENT).toContain(
      'commerce v5 cannot expose the protected final image as its public preview',
    )
    expect(CLIENT).toContain('imageBlobId: handoff.imageBlobId')
  })

  it('returns a nonce-bound, chain-verifiable receipt to the exact Animacraft origin', () => {
    expect(CLIENT).toContain('trustedAnimacraftReturnOrigin')
    expect(CLIENT).toContain('window.opener.postMessage')
    expect(CLIENT).toContain('SOULIDITY_ANIMACRAFT_COMPLETION_SCHEMA')
    expect(CLIENT).toContain(
      'const completionContext = mintFlow.result.recoveryContext',
    )
    expect(CLIENT).toContain(
      'completionContext.returnOrigin',
    )
    expect(CLIENT).toContain('returnNonce: completionContext.returnNonce')
    expect(CLIENT).toContain('txDigest: mintFlow.result.txDigest')
    expect(CLIENT).toContain('soulObjectId: mintFlow.result.soulOnChainId')
    expect(CLIENT).toContain(
      'provenanceObjectId: mintFlow.result.provenanceObjectId',
    )
    expect(CLIENT).toContain(
      '|| !mintFlow.result.outputProvenanceObjectId',
    )
    expect(CLIENT).toContain(
      'outputProvenanceObjectId:',
    )
  })

  it('extracts and persists the provenance object needed for Animacraft readback', () => {
    expect(MINT).toContain('animacraftProvenanceObjectId')
    expect(MINT).toContain('provenanceObjectId')
    expect(MINT).toContain('AnimacraftProvenanceCreated')
    expect(MINT).toContain(
      'tryExtractAnimacraftOutputProvenanceV5CreatedEvent',
    )
    expect(MINT).toContain('animacraftProtocolVersion: input.handoff.protocolVersion')
    expect(MINT).toContain('recoveryContext: inputRecoveryContext')
    expect(MINT).toContain(
      'recoveryContext: existingRecovery.recoveryContext',
    )
    expect(MINT).toContain('animacraftMintRecoveryContextsMatch')
    expect(MINT).toContain(
      'Recoverable commerce v5 mint is missing its completed-output provenance',
    )
  })

  it('normalizes and exactly binds every commerce v5 recovery dimension', () => {
    const context = normalizeAnimacraftMintRecoveryContext({
      protocolVersion: 5,
      makerId: '0x1',
      makerRootId: '0x2',
      recipeHashHex: `0x${'11'.repeat(32)}`,
      outputSealIdHex: `0x${'22'.repeat(32)}`,
      outputNonceHex: `0x${'33'.repeat(32)}`,
      outputDigestHex: `0x${'44'.repeat(32)}`,
      returnOrigin: 'https://animacraft.soulidity.ai',
      returnNonce: 'return-A',
    })
    expect(context).toMatchObject({
      protocolVersion: 5,
      makerId: `0x${'0'.repeat(63)}1`,
      makerRootId: `0x${'0'.repeat(63)}2`,
      returnOrigin: 'https://animacraft.soulidity.ai',
      returnNonce: 'return-A',
    })
    expect(animacraftMintRecoveryContextsMatch(context, context)).toBe(true)

    for (const [field, value] of [
      ['makerId', '0x3'],
      ['makerRootId', '0x4'],
      ['recipeHashHex', `0x${'55'.repeat(32)}`],
      ['outputSealIdHex', `0x${'66'.repeat(32)}`],
      ['outputNonceHex', `0x${'77'.repeat(32)}`],
      ['outputDigestHex', `0x${'88'.repeat(32)}`],
      ['returnOrigin', 'https://other.example'],
      ['returnNonce', 'return-B'],
    ] as const) {
      expect(animacraftMintRecoveryContextsMatch(
        context,
        { ...context!, [field]: value } as AnimacraftMintRecoveryContext,
      ), field).toBe(false)
    }
  })

  it('keeps v4 recovery compatible but rejects partial or v5-shaped v4 state', () => {
    const v4 = normalizeAnimacraftMintRecoveryContext({
      protocolVersion: 4,
      makerId: '0xa',
      recipeHashHex: `0x${'ab'.repeat(32)}`,
      returnOrigin: '',
      returnNonce: '',
    })
    expect(v4).not.toBeNull()
    expect(v4?.makerRootId).toBe('')

    expect(normalizeAnimacraftMintRecoveryContext({
      protocolVersion: 4,
      makerId: '0xa',
      recipeHashHex: `0x${'ab'.repeat(32)}`,
      returnOrigin: 'https://animacraft.soulidity.ai',
      returnNonce: '',
    })).toBeNull()
    expect(normalizeAnimacraftMintRecoveryContext({
      protocolVersion: 4,
      makerId: '0xa',
      makerRootId: '0xb',
      recipeHashHex: `0x${'ab'.repeat(32)}`,
    })).toBeNull()
  })

  it('fails closed when any protected v5 recovery field is absent', () => {
    const base = {
      protocolVersion: 5 as const,
      makerId: '0x1',
      makerRootId: '0x2',
      recipeHashHex: `0x${'11'.repeat(32)}`,
      outputSealIdHex: `0x${'22'.repeat(32)}`,
      outputNonceHex: `0x${'33'.repeat(32)}`,
      outputDigestHex: `0x${'44'.repeat(32)}`,
      returnOrigin: 'https://animacraft.soulidity.ai',
      returnNonce: 'return-A',
    }
    for (const field of [
      'makerRootId',
      'recipeHashHex',
      'outputSealIdHex',
      'outputNonceHex',
      'outputDigestHex',
      'returnOrigin',
      'returnNonce',
    ] as const) {
      expect(normalizeAnimacraftMintRecoveryContext({
        ...base,
        [field]: '',
      }), field).toBeNull()
    }
  })
})
