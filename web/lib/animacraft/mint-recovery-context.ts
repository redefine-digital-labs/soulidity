import { normalizeSuiAddress } from '@mysten/sui/utils'

export interface AnimacraftMintRecoveryContext {
  protocolVersion: 4 | 5
  makerId: string
  makerRootId: string
  recipeHashHex: string
  outputSealIdHex: string
  outputNonceHex: string
  outputDigestHex: string
  returnOrigin: string
  returnNonce: string
}

export interface AnimacraftMintRecoveryContextInput {
  protocolVersion: 4 | 5
  makerId: string
  makerRootId?: string | null
  recipeHashHex: string
  outputSealIdHex?: string | null
  outputNonceHex?: string | null
  outputDigestHex?: string | null
  returnOrigin?: string | null
  returnNonce?: string | null
}

const EXACT_32_BYTE_HEX = /^0x[0-9a-f]{64}$/i

export function normalizeAnimacraftRecoveryObjectId(
  value: string,
): string | null {
  const trimmed = value.trim()
  if (
    !/^0x[0-9a-f]{1,64}$/i.test(trimmed)
    || /^0x0+$/i.test(trimmed)
  ) return null
  try {
    return normalizeSuiAddress(trimmed).toLowerCase()
  } catch {
    return null
  }
}

export function normalizeAnimacraftRecoveryHash(
  value: string,
): string | null {
  const trimmed = value.trim()
  return EXACT_32_BYTE_HEX.test(trimmed) ? trimmed.toLowerCase() : null
}

function normalizeReturnOrigin(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    return parsed.origin === trimmed ? parsed.origin : null
  } catch {
    return null
  }
}

export function normalizeAnimacraftMintRecoveryContext(
  value: AnimacraftMintRecoveryContextInput | null | undefined,
): AnimacraftMintRecoveryContext | null {
  if (!value || (value.protocolVersion !== 4 && value.protocolVersion !== 5)) {
    return null
  }
  const makerId = normalizeAnimacraftRecoveryObjectId(
    String(value.makerId ?? ''),
  )
  const recipeHashHex = normalizeAnimacraftRecoveryHash(
    String(value.recipeHashHex ?? ''),
  )
  const returnOrigin = normalizeReturnOrigin(String(value.returnOrigin ?? ''))
  const returnNonce = String(value.returnNonce ?? '').trim()
  if (!makerId || !recipeHashHex || returnOrigin == null) return null

  const makerRootRaw = String(value.makerRootId ?? '').trim()
  const outputSealRaw = String(value.outputSealIdHex ?? '').trim()
  const outputNonceRaw = String(value.outputNonceHex ?? '').trim()
  const outputDigestRaw = String(value.outputDigestHex ?? '').trim()

  if (value.protocolVersion === 4) {
    if (
      makerRootRaw
      || outputSealRaw
      || outputNonceRaw
      || outputDigestRaw
      || Boolean(returnOrigin) !== Boolean(returnNonce)
    ) return null
    return {
      protocolVersion: 4,
      makerId,
      makerRootId: '',
      recipeHashHex,
      outputSealIdHex: '',
      outputNonceHex: '',
      outputDigestHex: '',
      returnOrigin,
      returnNonce,
    }
  }

  const makerRootId = normalizeAnimacraftRecoveryObjectId(makerRootRaw)
  const outputSealIdHex = normalizeAnimacraftRecoveryHash(outputSealRaw)
  const outputNonceHex = normalizeAnimacraftRecoveryHash(outputNonceRaw)
  const outputDigestHex = normalizeAnimacraftRecoveryHash(outputDigestRaw)
  if (
    !makerRootId
    || !outputSealIdHex
    || !outputNonceHex
    || !outputDigestHex
    || !returnOrigin
    || !returnNonce
  ) return null
  return {
    protocolVersion: 5,
    makerId,
    makerRootId,
    recipeHashHex,
    outputSealIdHex,
    outputNonceHex,
    outputDigestHex,
    returnOrigin,
    returnNonce,
  }
}

export function animacraftMintRecoveryContextsMatch(
  left: AnimacraftMintRecoveryContext | null | undefined,
  right: AnimacraftMintRecoveryContext | null | undefined,
): boolean {
  const normalizedLeft = normalizeAnimacraftMintRecoveryContext(left)
  const normalizedRight = normalizeAnimacraftMintRecoveryContext(right)
  if (!normalizedLeft || !normalizedRight) return false
  return normalizedLeft.protocolVersion === normalizedRight.protocolVersion
    && normalizedLeft.makerId === normalizedRight.makerId
    && normalizedLeft.makerRootId === normalizedRight.makerRootId
    && normalizedLeft.recipeHashHex === normalizedRight.recipeHashHex
    && normalizedLeft.outputSealIdHex === normalizedRight.outputSealIdHex
    && normalizedLeft.outputNonceHex === normalizedRight.outputNonceHex
    && normalizedLeft.outputDigestHex === normalizedRight.outputDigestHex
    && normalizedLeft.returnOrigin === normalizedRight.returnOrigin
    && normalizedLeft.returnNonce === normalizedRight.returnNonce
}
