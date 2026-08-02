import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDynamicFieldObject } = vi.hoisted(() => ({
  getDynamicFieldObject: vi.fn(),
}))

vi.mock('../../packages/soulidity-sdk/src/sui-client', () => ({
  suiClient: { getDynamicFieldObject },
}))

import {
  OnChainVerificationError,
  getAnimacraftAppearanceV6Id,
} from '../../packages/soulidity-sdk/src/queries'

describe('getAnimacraftAppearanceV6Id', () => {
  beforeEach(() => getDynamicFieldObject.mockReset())

  it('queries the stable u8 key and reads a nested UID bytes value', async () => {
    getDynamicFieldObject.mockResolvedValue({
      data: {
        content: {
          dataType: 'moveObject',
          fields: { value: { fields: { bytes: '0x42' } } },
        },
      },
    })

    await expect(getAnimacraftAppearanceV6Id('0x7')).resolves.toMatch(/42$/)
    expect(getDynamicFieldObject).toHaveBeenCalledWith({
      parentId: '0x7',
      name: { type: 'u8', value: 3 },
    })
  })

  it('returns null only for an explicit dynamic-field-not-found response', async () => {
    getDynamicFieldObject.mockResolvedValue({
      error: { code: 'dynamicFieldNotFound', message: 'Dynamic field not found' },
    })
    await expect(getAnimacraftAppearanceV6Id('0x7')).resolves.toBeNull()
  })

  it('fails closed for transport failures and malformed values', async () => {
    getDynamicFieldObject.mockRejectedValueOnce(new Error('signal timed out'))
    await expect(getAnimacraftAppearanceV6Id('0x7')).rejects.toThrow('signal timed out')

    getDynamicFieldObject.mockResolvedValueOnce({
      data: { content: { dataType: 'moveObject', fields: { value: {} } } },
    })
    await expect(getAnimacraftAppearanceV6Id('0x7')).rejects.toBeInstanceOf(
      OnChainVerificationError,
    )
  })
})
