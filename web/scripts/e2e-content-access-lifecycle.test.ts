import { describe, expect, it } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { buildInspectAccessTx } from './e2e-content-access-lifecycle'

describe('buildInspectAccessTx', () => {
  it('passes ContentAccessList, SoulState, grantee, scope, and clock in order', () => {
    const tx = buildInspectAccessTx({
      packageId: '0x1',
      accessListId: '0x111',
      stateId: '0x222',
      granteeAddress: '0x333',
      requiredScope: 15,
    })

    const data = tx.getData()
    const command = (data.commands[0] as { MoveCall: { arguments: Array<{ Input: number; type: string }> } })
      .MoveCall

    expect(data.inputs).toHaveLength(5)
    expect(data.inputs[0]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x111') },
    })
    expect(data.inputs[1]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x222') },
    })
    expect(data.inputs[4]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x6') },
    })
    expect(command.arguments).toEqual([
      { Input: 0, type: 'object', $kind: 'Input' },
      { Input: 1, type: 'object', $kind: 'Input' },
      { Input: 2, type: 'pure', $kind: 'Input' },
      { Input: 3, type: 'pure', $kind: 'Input' },
      { Input: 4, type: 'object', $kind: 'Input' },
    ])
  })
})
