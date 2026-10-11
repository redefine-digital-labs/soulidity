import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SOULIDITY_DEPLOYMENT_SIGNATURE_KEY,
  SOULIDITY_SESSION_KEYS,
  attachSoulidityDeploymentSignature,
  getSoulidityDeploymentSignature,
  getSoulidityDeployment,
  hasCurrentSoulidityDeploymentSignature,
  syncSoulidityDeploymentSession,
} from '@soulidity/sdk'

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
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
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_ENV.NEXT_PUBLIC_SUI_NETWORK
  })

  it('attaches the current deployment signature to persisted payloads', () => {
    expect(attachSoulidityDeploymentSignature({ userId: 'member-1' })).toEqual({
      userId: 'member-1',
      deploymentSignature: getSoulidityDeploymentSignature(),
    })
  })

  it('scopes a fresh deployment without requiring or aliasing a legacy market ID', () => {
    const deployment = getSoulidityDeployment()
    const priorLegacy = deployment.marketConfigId, priorV2 = deployment.marketConfigV2Id
    try {
      delete deployment.marketConfigId
      deployment.marketConfigV2Id = `0x${'7'.repeat(64)}`
      const first = getSoulidityDeploymentSignature()
      expect(first).toContain(deployment.marketConfigV2Id)
      expect(deployment.marketConfigId).toBeUndefined()
      const record = attachSoulidityDeploymentSignature({ txDigest: 'unresolved' })
      expect(hasCurrentSoulidityDeploymentSignature(record)).toBe(true)
      deployment.marketConfigV2Id = `0x${'8'.repeat(64)}`
      expect(getSoulidityDeploymentSignature()).not.toBe(first)
      expect(hasCurrentSoulidityDeploymentSignature(record)).toBe(false)
    } finally {
      if (priorLegacy === undefined) delete deployment.marketConfigId
      else deployment.marketConfigId = priorLegacy
      deployment.marketConfigV2Id = priorV2
    }
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
