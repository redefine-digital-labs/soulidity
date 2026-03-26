import { describe, expect, it, vi } from 'vitest'

import {
  selectCoinObjectIdsForAmount,
  selectCoinObjectIdsForAmountAcrossPages,
} from '../../web/lib/souls/coin-selection.ts'

describe('selectCoinObjectIdsForAmount', () => {
  it('returns enough coin ids to cover a fragmented balance', () => {
    expect(selectCoinObjectIdsForAmount([
      { coinObjectId: 'coin-a', balance: '400000' },
      { coinObjectId: 'coin-b', balance: '700000' },
      { coinObjectId: 'coin-c', balance: '300000' },
    ], 1_000_000n)).toEqual(['coin-a', 'coin-b'])
  })

  it('returns null when the aggregate balance is insufficient', () => {
    expect(selectCoinObjectIdsForAmount([
      { coinObjectId: 'coin-a', balance: '400000' },
      { coinObjectId: 'coin-b', balance: '500000' },
    ], 1_000_000n)).toBeNull()
  })

  it('rejects unsafe numeric balances before converting them to bigint', () => {
    expect(() => selectCoinObjectIdsForAmount([
      { coinObjectId: 'coin-a', balance: Number.MAX_SAFE_INTEGER + 10 },
    ], 1n)).toThrow('Coin balance number is outside the safe integer range')
  })
})

describe('selectCoinObjectIdsForAmountAcrossPages', () => {
  it('keeps paging until fragmented balance reaches the required amount', async () => {
    const client = {
      getCoins: vi.fn()
        .mockResolvedValueOnce({
          data: [{ coinObjectId: 'coin-a', balance: '400000' }],
          hasNextPage: true,
          nextCursor: 'cursor-1',
        })
        .mockResolvedValueOnce({
          data: [{ coinObjectId: 'coin-b', balance: '700000' }],
          hasNextPage: false,
          nextCursor: null,
        }),
    }

    await expect(selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: '0x1',
      coinType: '0x2::coin::Coin<0x2::sui::SUI>',
      requiredAmount: 1_000_000n,
    })).resolves.toEqual(['coin-a', 'coin-b'])
    expect(client.getCoins).toHaveBeenCalledTimes(2)
  })

  it('stops after all pages when the aggregate balance is still insufficient', async () => {
    const client = {
      getCoins: vi.fn()
        .mockResolvedValueOnce({
          data: [{ coinObjectId: 'coin-a', balance: '400000' }],
          hasNextPage: true,
          nextCursor: 'cursor-1',
        })
        .mockResolvedValueOnce({
          data: [{ coinObjectId: 'coin-b', balance: '500000' }],
          hasNextPage: false,
          nextCursor: null,
        }),
    }

    await expect(selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: '0x1',
      coinType: '0x2::coin::Coin<0x2::sui::SUI>',
      requiredAmount: 1_000_000n,
    })).resolves.toBeNull()
    expect(client.getCoins).toHaveBeenCalledTimes(2)
  })

  it('treats zero-balance wallets as insufficient funds instead of success', async () => {
    const client = {
      getCoins: vi.fn().mockResolvedValue({
        data: [
          { coinObjectId: 'coin-a', balance: '0' },
          { coinObjectId: 'coin-b', balance: 0 },
        ],
        hasNextPage: false,
        nextCursor: null,
      }),
    }

    await expect(selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: '0x1',
      coinType: '0x2::coin::Coin<0x2::sui::SUI>',
      requiredAmount: 1n,
    })).resolves.toBeNull()
  })

  it('keeps paginating past the tenth page before reporting insufficient funds', async () => {
    const client = {
      getCoins: vi.fn(),
    }

    for (let index = 0; index < 10; index += 1) {
      client.getCoins.mockResolvedValueOnce({
        data: [{ coinObjectId: `coin-${index}`, balance: '1' }],
        hasNextPage: true,
        nextCursor: `cursor-${index + 1}`,
      })
    }

    client.getCoins.mockResolvedValueOnce({
      data: [{ coinObjectId: 'coin-10', balance: '10' }],
      hasNextPage: false,
      nextCursor: null,
    })

    await expect(selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: '0x1',
      coinType: '0x2::coin::Coin<0x2::sui::SUI>',
      requiredAmount: 20n,
    })).resolves.toEqual([
      'coin-0',
      'coin-1',
      'coin-2',
      'coin-3',
      'coin-4',
      'coin-5',
      'coin-6',
      'coin-7',
      'coin-8',
      'coin-9',
      'coin-10',
    ])
    expect(client.getCoins).toHaveBeenCalledTimes(11)
  })

  it('fails distinctly when pagination claims more pages without a usable nextCursor', async () => {
    const client = {
      getCoins: vi.fn().mockResolvedValue({
        data: [{ coinObjectId: 'coin-a', balance: '1' }],
        hasNextPage: true,
        nextCursor: null,
      }),
    }

    await expect(selectCoinObjectIdsForAmountAcrossPages(client, {
      owner: '0x1',
      coinType: '0x2::coin::Coin<0x2::sui::SUI>',
      requiredAmount: 2n,
    })).rejects.toThrow('Coin pagination reported additional pages without a cursor')
  })
})
