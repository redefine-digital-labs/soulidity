import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SOULIDITY_DEPLOYMENT_SIGNATURE_KEY,
  SOULIDITY_SESSION_KEYS,
  attachSoulidityDeploymentSignature,
  getSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
  syncSoulidityDeploymentSession,
} from '@/lib/soulidity/client-session'

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
  NEXT_PUBLIC_SOULIDITY_PACKAGE_ID: process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID,
  NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID: process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID,
  NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID,
  NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID,
}

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))

  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

describe('Soulidity client deployment session', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = `0x${'a'.repeat(64)}`
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = `0x${'b'.repeat(64)}`
    process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = `0x${'c'.repeat(64)}`
    process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = `0x${'d'.repeat(64)}`
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_ENV.NEXT_PUBLIC_SUI_NETWORK
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = ORIGINAL_ENV.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = ORIGINAL_ENV.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID
    process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = ORIGINAL_ENV.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID
    process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = ORIGINAL_ENV.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID
  })

  it('attaches the current deployment signature to persisted payloads', () => {
    expect(attachSoulidityDeploymentSignature({ userId: 'member-1' })).toEqual({
      userId: 'member-1',
      deploymentSignature: getSoulidityDeploymentSignature(),
    })
  })

  it('accepts only payloads scoped to the active deployment signature', () => {
    expect(hasCurrentSoulidityDeploymentSignature(attachSoulidityDeploymentSignature({ txDigest: '5Yz' }))).toBe(true)
    expect(hasCurrentSoulidityDeploymentSignature({ txDigest: '5Yz' })).toBe(false)
    expect(hasCurrentSoulidityDeploymentSignature({
      txDigest: '5Yz',
      deploymentSignature: 'testnet|0xstale',
    })).toBe(false)
  })

  it('clears all known Soulidity session keys when the deployment signature changes', () => {
    const staleSignature = 'testnet|0xstale'
    const storage = createStorage({
      [SOULIDITY_DEPLOYMENT_SIGNATURE_KEY]: staleSignature,
      ...Object.fromEntries(SOULIDITY_SESSION_KEYS.map((key) => [key, `${key}-value`])),
    })

    expect(syncSoulidityDeploymentSession(storage)).toEqual({
      changed: true,
      currentSignature: getSoulidityDeploymentSignature(),
    })
    expect(storage.getItem(SOULIDITY_DEPLOYMENT_SIGNATURE_KEY)).toBe(getSoulidityDeploymentSignature())

    for (const key of SOULIDITY_SESSION_KEYS) {
      expect(storage.getItem(key)).toBeNull()
    }
  })

  it('only records the signature on first boot without clearing current session state', () => {
    const storage = createStorage({
      [SOULIDITY_SESSION_KEYS[0]]: 'kept',
    })

    expect(syncSoulidityDeploymentSession(storage)).toEqual({
      changed: false,
      currentSignature: getSoulidityDeploymentSignature(),
    })
    expect(storage.getItem(SOULIDITY_DEPLOYMENT_SIGNATURE_KEY)).toBe(getSoulidityDeploymentSignature())
    expect(storage.getItem(SOULIDITY_SESSION_KEYS[0])).toBe('kept')
  })
})
