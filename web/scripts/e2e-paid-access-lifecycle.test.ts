import { describe, expect, it } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
  buildInspectAccessTx,
  buildInspectConfigTx,
} from './e2e-paid-access-lifecycle'

describe('buildInspectAccessTx', () => {
  it('passes SoulPaidAccessList, SoulState, grantee, kind, scope, and clock in order', () => {
    const tx = buildInspectAccessTx({
      packageId: '0x1',
      paidAccessListObjectId: '0x111',
      stateObjectId: '0x222',
      granteeAddress: '0x333',
      kind: 3,
      requiredScope: 8,
    })

    const data = tx.getData()
    const command = (
      data.commands[0] as { MoveCall: { arguments: Array<{ Input: number; type: string }> } }
    ).MoveCall

    // Inputs: list, state, granteeAddr, kind, scope, clock — 6 total.
    expect(data.inputs).toHaveLength(6)
    expect(data.inputs[0]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x111') },
    })
    expect(data.inputs[1]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x222') },
    })
    expect(data.inputs[5]).toMatchObject({
      UnresolvedObject: { objectId: normalizeSuiAddress('0x6') },
    })
    expect(command.arguments).toEqual([
      { Input: 0, type: 'object', $kind: 'Input' },
      { Input: 1, type: 'object', $kind: 'Input' },
      { Input: 2, type: 'pure', $kind: 'Input' },
      { Input: 3, type: 'pure', $kind: 'Input' },
      { Input: 4, type: 'pure', $kind: 'Input' },
      { Input: 5, type: 'object', $kind: 'Input' },
    ])
  })
})

describe('buildInspectConfigTx', () => {
  it('queues 4 accessor moveCalls in order: has_kind_config, price, scope, duration', () => {
    const tx = buildInspectConfigTx({
      packageId: '0x1',
      paidAccessListObjectId: '0x111',
      kind: 4,
    })

    const data = tx.getData()
    expect(data.commands).toHaveLength(4)

    const targets = (data.commands as Array<{ MoveCall: { module: string; function: string } }>).map(
      (c) => `${c.MoveCall.module}::${c.MoveCall.function}`,
    )
    expect(targets).toEqual([
      'paid_access::has_kind_config',
      'paid_access::kind_config_price_atomic',
      'paid_access::kind_config_scope_mask',
      'paid_access::kind_config_duration_ms',
    ])
  })
})
