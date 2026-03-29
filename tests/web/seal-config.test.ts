import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

vi.mock('server-only', () => ({}))

describe('Seal service configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.SEAL_SERVER_CONFIGS
    delete process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID
    delete process.env.NEXT_PUBLIC_SUI_NETWORK
    delete process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS
    delete process.env.NEXT_PUBLIC_SEAL_THRESHOLD
    delete process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('uses the soul object package id as the access policy package and falls back to testnet defaults', async () => {
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = '0xsoul'

    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.hasSealSessionConfig()).toBe(true)
    expect(mod.getOwnerSealSession({
      soulObjectId: '0xsoul-object',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xkioskcap',
    })).toEqual({
      packageId: '0xsoul',
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
      packageId: '0xsoul',
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

  it('honors explicit runtime overrides', async () => {
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = '0xoverride'
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
        objectId: '0xabc',
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
          objectId: '0xabc',
          weight: 1,
          aggregatorUrl: 'https://example.com',
        },
      ],
    })
    expect(mod.hasCredentialedSealServerConfigs()).toBe(true)
    expect(consoleWarn).toHaveBeenCalledWith('Seal threshold is 1-of-1 on mainnet')
    consoleWarn.mockRestore()
  })

  it('reports missing session config when the soul object package is absent', async () => {
    const mod = await import('../../web/lib/services/seal.ts')

    expect(mod.hasSealSessionConfig()).toBe(false)
  })
})
