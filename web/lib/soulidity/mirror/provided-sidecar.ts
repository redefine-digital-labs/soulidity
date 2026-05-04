import type { SealEnvelopeSidecar } from '@soulidity/sdk'

export class SealSidecarRequestError extends Error {}

export function parseProvidedSidecar(
  value: unknown,
  fieldName = 'sealSidecar',
): SealEnvelopeSidecar | null {
  if (value == null) return null
  if (typeof value === 'string') {
    throw new SealSidecarRequestError(`${fieldName} must be a Seal sidecar object, not a raw DEK envelope`)
  }
  if (typeof value !== 'object') {
    throw new SealSidecarRequestError(`${fieldName} must be a Seal sidecar object`)
  }
  return value as SealEnvelopeSidecar
}
