import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deploymentManifest from '@soulidity/sdk/deployment-manifest.json'

const ORIGINAL_ENV = { ...process.env }

vi.mock('server-only', () => ({}))

describe('Seal service configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.SEAL_SERVER_CONFIGS
    delete process.env.NEXT_PUBLIC_SUI_NETWORK
    delete process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS
    delete process.env.NEXT_PUBLIC_SEAL_THRESHOLD
    delete process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS
    delete process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID
    delete process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID
    delete process.env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('uses the active Soulidity manifest package id as the access policy package and falls back to testnet defaults', async () => {
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.hasSealSessionConfig()).toBe(true)
    expect(mod.getOwnerSealSession({
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toEqual({
      packageId: deploymentManifest.testnet.originalPackageId,
      sealPackageId: deploymentManifest.testnet.originalPackageId,
      callablePackageId: deploymentManifest.testnet.callablePackageId,
      soulObjectId: '0xsoul-object',
      moduleName: 'seal_policy',
      functionName: 'seal_approve_owner_in_personal_kiosk',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
      allowlistRegistryObjectId: null,
      soulAllowlistCapObjectId: null,
    })
    expect(mod.getAllowlistedSealSession({
      soulObjectId: '0xsoul-object',
      allowlistRegistryObjectId: '0xallowlist',
    })).toEqual({
      packageId: deploymentManifest.testnet.originalPackageId,
      sealPackageId: deploymentManifest.testnet.originalPackageId,
      callablePackageId: deploymentManifest.testnet.callablePackageId,
      soulObjectId: '0xsoul-object',
      moduleName: 'seal_policy',
      functionName: 'seal_approve_allowlisted',
      currentKioskId: null,
      currentKioskCapOnChainId: null,
      allowlistRegistryObjectId: '0xallowlist',
      soulAllowlistCapObjectId: null,
    })

    expect(mod.getSealRuntimeConfig()).toEqual({
      network: 'testnet',
      threshold: 1,
      verifyKeyServers: true,
      serverConfigs: [
        {
          objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
          weight: 1,
        },
      ],
    })
    expect(mod.hasCredentialedSealServerConfigs()).toBe(false)
  })

  it('accepts the active original package and rejects untrusted namespaces', async () => {
    const mod = await import('../../web/lib/services/seal.ts')
    const originalPackageId = deploymentManifest.testnet.originalPackageId

    expect(mod.getOwnerSealSession({
      sealPackageId: originalPackageId,
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toMatchObject({
      packageId: originalPackageId,
      sealPackageId: originalPackageId,
      callablePackageId: deploymentManifest.testnet.callablePackageId,
    })

    expect(mod.getAllowlistedSealSession({
      sealPackageId: originalPackageId,
      soulObjectId: '0xsoul-object',
      allowlistRegistryObjectId: '0xallowlist',
    })).toMatchObject({
      packageId: originalPackageId,
      sealPackageId: originalPackageId,
      callablePackageId: deploymentManifest.testnet.callablePackageId,
    })

    expect(() => mod.getOwnerSealSession({
      sealPackageId: `0x${'ff'.repeat(32)}`,
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toThrow('Seal namespace is not a trusted Soulidity package family')
  })

  it('uses fresh deployment env package ids ahead of the bundled manifest', async () => {
    const freshOriginal = `0x${'aa'.repeat(32)}`
    const freshCallable = `0x${'bb'.repeat(32)}`
    process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID = freshOriginal
    process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID = freshCallable
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.getSouliditySealPackageId()).toBe(freshOriginal)
    expect(mod.getSouliditySealCallablePackageId()).toBe(freshCallable)
    expect(mod.getOwnerSealSession({
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toMatchObject({
      packageId: freshOriginal,
      sealPackageId: freshOriginal,
      callablePackageId: freshCallable,
    })
  })

  it('routes historical ciphertext through its own package family callable', async () => {
    const historicalOriginal = `0x${'44'.repeat(32)}`
    const historicalCallable = `0x${'55'.repeat(32)}`
    process.env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES = JSON.stringify([{
      sealPackageId: historicalOriginal,
      callablePackageId: historicalCallable,
    }])
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.getOwnerSealSession({
      sealPackageId: historicalOriginal,
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toMatchObject({
      packageId: historicalOriginal,
      sealPackageId: historicalOriginal,
      callablePackageId: historicalCallable,
    })
  })

  it('fails closed on conflicting package-family routes', async () => {
    const currentOriginal = deploymentManifest.testnet.originalPackageId
    process.env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES = JSON.stringify([{
      sealPackageId: currentOriginal,
      callablePackageId: `0x${'66'.repeat(32)}`,
    }])
    const mod = await import('../../web/lib/services/seal.ts')
    expect(() => mod.getSouliditySealPackageRoutes()).toThrow(
      'conflicting callable routes',
    )
  })

  it('creates SessionKey identity under the original package, never the callable target', async () => {
    const mod = await import('../../web/lib/services/seal.ts')
    const address = `0x${'11'.repeat(32)}`
    let requestedPackageId = ''
    const client = {
      core: {
        getObject: vi.fn(async ({ objectId }: { objectId: string }) => {
          requestedPackageId = objectId
          return { object: { version: 1 } }
        }),
      },
    }

    const sessionKey = await mod.createSealSessionKey({
      toSuiAddress: () => address,
      getPublicKey: () => ({ toSuiAddress: () => address }),
    } as never, client as never)

    expect(requestedPackageId).toBe(deploymentManifest.testnet.originalPackageId)
    expect(sessionKey.getPackageId()).toBe(deploymentManifest.testnet.originalPackageId)
  })

  it('can create a SessionKey under a trusted historical package family', async () => {
    const historicalOriginal = `0x${'44'.repeat(32)}`
    const historicalCallable = `0x${'55'.repeat(32)}`
    process.env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES = JSON.stringify([{
      sealPackageId: historicalOriginal,
      callablePackageId: historicalCallable,
    }])
    const mod = await import('../../web/lib/services/seal.ts')
    const address = `0x${'11'.repeat(32)}`
    let requestedPackageId = ''
    const client = {
      core: {
        getObject: vi.fn(async ({ objectId }: { objectId: string }) => {
          requestedPackageId = objectId
          return { object: { version: 1 } }
        }),
      },
    }

    const sessionKey = await mod.createSealSessionKey({
      toSuiAddress: () => address,
      getPublicKey: () => ({ toSuiAddress: () => address }),
    } as never, client as never, historicalOriginal)

    expect(requestedPackageId).toBe(historicalOriginal)
    expect(sessionKey.getPackageId()).toBe(historicalOriginal)
    await expect(mod.createSealSessionKey({
      toSuiAddress: () => address,
      getPublicKey: () => ({ toSuiAddress: () => address }),
    } as never, client as never, `0x${'ff'.repeat(32)}`)).rejects.toThrow(
      'Seal namespace is not a trusted Soulidity package family',
    )
  })

  it('honors explicit runtime overrides', async () => {
    const normalizedObjectId = `0x${'0'.repeat(61)}abc`
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SEAL_THRESHOLD = '1'
    process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS = 'false'
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([
      {
        objectId: '0xabc',
        weight: 1,
        aggregatorUrl: 'https://example.com',
        apiKeyName: 'public-name',
        apiKey: 'public-secret',
      },
    ])
    process.env.SEAL_SERVER_CONFIGS = JSON.stringify([
      {
        objectId: normalizedObjectId,
        apiKeyName: 'x-seal-api-key',
        apiKey: 'server-secret',
      },
    ])

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.getSealRuntimeConfig()).toEqual({
      network: 'mainnet',
      threshold: 1,
      verifyKeyServers: false,
      serverConfigs: [
        {
          objectId: normalizedObjectId,
          weight: 1,
          aggregatorUrl: 'https://example.com',
        },
      ],
    })
    expect(mod.hasCredentialedSealServerConfigs()).toBe(true)
    expect(consoleWarn).toHaveBeenCalledWith(
      'Seal uses one physical key server on mainnet (threshold 1)',
    )
    consoleWarn.mockRestore()
  })

  it('rejects fractional, excessive, and under-threshold Seal weight configurations', async () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SEAL_THRESHOLD = '2'
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId: `0x${'77'.repeat(32)}`,
      weight: 0.5,
    }])
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(false)

    vi.resetModules()
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId: `0x${'77'.repeat(32)}`,
      weight: 255,
    }])
    mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(false)
    expect(consoleWarn).toHaveBeenCalledWith(
      'Seal key server weight must total less than 255; received 255 on mainnet',
    )

    vi.resetModules()
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId: `0x${'77'.repeat(32)}`,
      weight: 1,
    }])
    mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(false)
    expect(consoleWarn).toHaveBeenCalledWith('Seal threshold 2 exceeds the configured weight 1')

    vi.resetModules()
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId: `0x${'77'.repeat(32)}`,
      weight: 2,
    }])
    mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(true)
    expect(mod.getSealRuntimeConfig().threshold).toBe(2)
    consoleWarn.mockRestore()
  })

  it('preserves public Seal weight when server credentials omit weight', async () => {
    const objectId = `0x${'77'.repeat(32)}`
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SEAL_THRESHOLD = '2'
    process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId,
      weight: 2,
    }])
    process.env.SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId,
      aggregatorUrl: 'https://seal.example.com',
      apiKeyName: 'x-seal-key',
      apiKey: 'secret',
    }])
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(true)
    expect(mod.getSealRuntimeConfig()).toMatchObject({ threshold: 2 })

    vi.resetModules()
    process.env.SEAL_SERVER_CONFIGS = JSON.stringify([{
      objectId,
      weight: 1,
    }])
    mod = await import('../../web/lib/services/seal.ts')
    expect(mod.hasSealSessionConfig()).toBe(false)
    expect(consoleWarn).toHaveBeenCalledWith(
      `SEAL_SERVER_CONFIGS must preserve public weight 2 for ${objectId}`,
    )
    consoleWarn.mockRestore()
  })

  it('reports missing session config on mainnet when Seal key servers are absent', async () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.hasSealSessionConfig()).toBe(false)
    expect(consoleWarn).toHaveBeenCalledWith('Seal key server config is empty on mainnet')
    consoleWarn.mockRestore()
  })
})
