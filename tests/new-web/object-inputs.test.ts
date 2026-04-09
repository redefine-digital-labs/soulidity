import { describe, expect, it, vi } from 'vitest'

import { assertObjectInputsExist, findMissingObjectIds } from '@/lib/soulidity/object-inputs'

describe('findMissingObjectIds', () => {
  it('returns object ids whose RPC responses are missing or report not found', async () => {
    const client = {
      multiGetObjects: vi.fn().mockResolvedValue([
        { data: { objectId: '0x1' } },
        { data: null, error: { code: 'notExists', error: 'Object not found' } },
        { error: { code: 'unknown', message: 'Some requested entity was not found' } },
      ]),
    }

    await expect(findMissingObjectIds(client as never, ['0x1', '0x2', '0x3']))
      .resolves.toEqual(['0x2', '0x3'])
  })

  it('deduplicates ids and ignores empty inputs', async () => {
    const client = {
      multiGetObjects: vi.fn().mockResolvedValue([
        { data: { objectId: '0x1' } },
        { data: null, error: { code: 'notExists' } },
      ]),
    }

    await expect(findMissingObjectIds(client as never, ['0x1', undefined, '0x2', '0x2', null]))
      .resolves.toEqual(['0x2'])

    expect(client.multiGetObjects).toHaveBeenCalledWith({
      ids: ['0x1', '0x2'],
      options: { showType: true },
    })
  })

  it('skips the RPC call when no candidate ids are present', async () => {
    const client = {
      multiGetObjects: vi.fn(),
    }

    await expect(findMissingObjectIds(client as never, [undefined, null, '']))
      .resolves.toEqual([])
    expect(client.multiGetObjects).not.toHaveBeenCalled()
  })

  it('throws a labeled refresh hint when required object inputs are missing', async () => {
    const client = {
      multiGetObjects: vi.fn().mockResolvedValue([
        { data: { objectId: '0x1' } },
        { data: null, error: { code: 'notExists' } },
      ]),
    }

    await expect(assertObjectInputsExist(client as never, {
      'Soul listing': '0x1',
      'Soul state': '0x2',
    })).rejects.toThrow('Soul state is no longer available on-chain')
  })
})
