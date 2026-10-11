import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { describe, expect, it, vi } from 'vitest'

import { SuiGrpcJsonRpcCompatClient } from '../../packages/soulidity-sdk/src/sui-grpc-compat'

function compatWithCore(core: Record<string, unknown>) {
  const grpc = {
    core,
    cache: {},
    base: {},
    $extend: vi.fn(),
  } as unknown as SuiGrpcClient
  return new SuiGrpcJsonRpcCompatClient('mainnet', grpc)
}

describe('Sui gRPC JSON-RPC compatibility boundary', () => {
  it('maps supported Core API chain and balance reads to the legacy shape', async () => {
    const client = compatWithCore({
      getChainIdentifier: vi.fn().mockResolvedValue({
        chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
      }),
      getBalance: vi.fn().mockResolvedValue({
        balance: { coinType: '0x2::sui::SUI', balance: '42' },
      }),
    })

    await expect(client.getChainIdentifier()).resolves.toBe('35834a8a')
    await expect(client.getBalance({ owner: '0x1' })).resolves.toMatchObject({
      coinType: '0x2::sui::SUI',
      totalBalance: '42',
      lockedBalance: {},
    })
  })

  it('only converts genuine object absence into a legacy not-found response', async () => {
    const absent = compatWithCore({
      getObject: vi.fn().mockRejectedValue(new Error('Object 0x1 not found')),
    })
    await expect(absent.getObject({ id: '0x1' })).resolves.toMatchObject({
      data: null,
      error: { code: 'notFound' },
    })

    const unavailable = compatWithCore({
      getObject: vi.fn().mockRejectedValue(new Error('signal timed out')),
    })
    await expect(unavailable.getObject({ id: '0x1' })).rejects.toThrow('signal timed out')

    const gateway404 = compatWithCore({
      getObject: vi.fn().mockRejectedValue(new Error('404 Not Found')),
    })
    await expect(gateway404.getObject({ id: '0x1' })).rejects.toThrow('404 Not Found')

    const grpcAbsent = compatWithCore({
      getObject: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 5 })),
    })
    await expect(grpcAbsent.getObject({ id: '0x1' })).resolves.toMatchObject({
      data: null,
      error: { code: 'notFound' },
    })
  })

  it('omits ephemeral objects and preserves durable created/deleted changes', async () => {
    const client = compatWithCore({
      getTransaction: vi.fn().mockResolvedValue({
        Transaction: {
          digest: 'tx-digest',
          status: { success: true, error: null },
          effects: {
            transactionDigest: 'tx-digest',
            status: { success: true, error: null },
            gasUsed: {},
            changedObjects: [
              {
                objectId: '0xephemeral',
                inputState: 'DoesNotExist',
                outputState: 'DoesNotExist',
                outputVersion: null,
                outputDigest: null,
                outputOwner: null,
                idOperation: 'Created',
              },
              {
                objectId: '0xcreated',
                inputState: 'DoesNotExist',
                outputState: 'ObjectWrite',
                outputVersion: '1',
                outputDigest: 'created-digest',
                outputOwner: { $kind: 'AddressOwner', AddressOwner: '0x1' },
                idOperation: 'Created',
              },
              {
                objectId: '0xdeleted',
                inputState: 'Exists',
                outputState: 'DoesNotExist',
                outputVersion: null,
                outputDigest: null,
                outputOwner: null,
                idOperation: 'Deleted',
              },
            ],
          },
          objectTypes: { '0xcreated': '0x2::example::Created' },
        },
      }),
    })

    const result = await client.getTransactionBlock({
      digest: 'tx-digest',
      options: { showEffects: true, showObjectChanges: true },
    })

    expect(result.effects?.status).toEqual({ status: 'success', error: null })
    expect(result.objectChanges).toEqual([
      expect.objectContaining({ type: 'created', objectId: '0xcreated' }),
      expect.objectContaining({ type: 'deleted', objectId: '0xdeleted' }),
    ])
  })

  it('projects padded Core Move addresses using the legacy compact spelling', async () => {
    const paddedFramework = `0x${'0'.repeat(63)}2`
    const client = compatWithCore({
      getTransaction: vi.fn().mockResolvedValue({
        Transaction: {
          digest: 'tx-digest',
          status: { success: true, error: null },
          effects: {
            transactionDigest: 'tx-digest',
            status: { success: true, error: null },
            gasUsed: {},
            changedObjects: [{
              objectId: '0xcap',
              inputState: 'DoesNotExist',
              outputState: 'ObjectWrite',
              outputVersion: '1',
              outputDigest: 'digest',
              outputOwner: { $kind: 'AddressOwner', AddressOwner: '0x1' },
              idOperation: 'Created',
            }],
          },
          objectTypes: {
            '0xcap': `${paddedFramework}::package::UpgradeCap`,
          },
        },
      }),
    })

    const result = await client.getTransactionBlock({
      digest: 'tx-digest',
      options: { showObjectChanges: true },
    })
    expect(result.objectChanges).toEqual([
      expect.objectContaining({ objectType: '0x2::package::UpgradeCap' }),
    ])
  })
})
