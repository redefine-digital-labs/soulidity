// Fresh deployment's single Seal wire profile. Keep in sync with Animacraft's
// maker-v8-seal-profile.js and seal_v8.move; cross-product tests compare values.
// H2/H3 are Seal's domain-separated SHA3-256 derivations, not HKDF.
export const NATIVE_SEAL_ENCRYPTION_PROFILE = Object.freeze({
  cipherSuite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
  keyDerivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00',
  ciphertextFormat: 'Seal/EncryptedObject/BCS/v0',
} as const)

export function assertNativeSealEncryptionProfile(value: unknown): typeof NATIVE_SEAL_ENCRYPTION_PROFILE {
  const profile = value as Record<string, unknown> | null
  if (!profile || typeof profile !== 'object'
    || profile.cipherSuite !== NATIVE_SEAL_ENCRYPTION_PROFILE.cipherSuite
    || profile.keyDerivation !== NATIVE_SEAL_ENCRYPTION_PROFILE.keyDerivation
    || profile.ciphertextFormat !== NATIVE_SEAL_ENCRYPTION_PROFILE.ciphertextFormat) {
    throw Object.assign(new Error('Unsupported Seal encryption profile.'), { code: 'NATIVE_SEAL_PROFILE_UNSUPPORTED' })
  }
  return NATIVE_SEAL_ENCRYPTION_PROFILE
}
