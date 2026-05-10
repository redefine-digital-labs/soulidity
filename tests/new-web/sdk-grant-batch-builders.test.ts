import { describe, expect, it } from 'vitest'

import { Transaction } from '@mysten/sui/transactions'
import {
  MAX_GRANT_BATCH_SIZE,
  SOUL_GRANT_SCOPE_ASSETS,
  addIssueGrantCalls,
  addSetGrantCapacityCalls,
  buildBatchIssueGrantsTx,
  buildBatchRevokeGrantsTx,
  buildIssueGrantTx,
  buildSetGrantCapacityTx,
} from '@soulidity/sdk'

const STATE_A = '0x' + 'a'.repeat(64)
const STATE_B = '0x' + 'b'.repeat(64)
const GRANTEE = '0x' + '1'.repeat(64)

function countGrantMoveCalls(tx: ReturnType<typeof buildBatchIssueGrantsTx>, suffix: string) {
  const json = JSON.parse(JSON.stringify(tx.getData()))
  const commands = json?.commands ?? []
  return commands.filter((cmd: { MoveCall?: { module?: string; function?: string } }) => {
    return cmd?.MoveCall?.module === 'grant' && cmd?.MoveCall?.function === suffix
  }).length
}

describe('buildBatchIssueGrantsTx', () => {
  const futureExpiry = Date.now() + 60_000

  it('emits one grant::issue_to_grantee call per item in order', () => {
    const tx = buildBatchIssueGrantsTx({
      items: [
        { stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: futureExpiry },
        { stateObjectId: STATE_B, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: futureExpiry },
      ],
    })

    expect(countGrantMoveCalls(tx, 'issue_to_grantee')).toBe(2)
  })

  it('rejects empty item list', () => {
    expect(() => buildBatchIssueGrantsTx({ items: [] })).toThrow(/at least one entry/)
  })

  it('rejects an oversized batch instead of silently truncating', () => {
    const items = Array.from({ length: MAX_GRANT_BATCH_SIZE + 1 }, () => ({
      stateObjectId: STATE_A,
      granteeAddress: GRANTEE,
      scopeMask: SOUL_GRANT_SCOPE_ASSETS,
      expiresAtMs: futureExpiry,
    }))
    expect(() => buildBatchIssueGrantsTx({ items })).toThrow(/MAX_GRANT_BATCH_SIZE/)
  })

  it('rejects empty grantee address inside the batch', () => {
    expect(() =>
      buildBatchIssueGrantsTx({
        items: [
          { stateObjectId: STATE_A, granteeAddress: '   ', scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: futureExpiry },
        ],
      }),
    ).toThrow(/granteeAddress/)
  })

  it('rejects non-positive scope mask inside the batch', () => {
    expect(() =>
      buildBatchIssueGrantsTx({
        items: [
          { stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: 0, expiresAtMs: futureExpiry },
        ],
      }),
    ).toThrow(/scopeMask/)
  })

  it('rejects past expiry inside the batch', () => {
    expect(() =>
      buildBatchIssueGrantsTx({
        items: [
          { stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: 1 },
        ],
      }),
    ).toThrow(/expiresAtMs/)
  })

  it('accepts null/undefined expiry (lifetime grants)', () => {
    const tx = buildBatchIssueGrantsTx({
      items: [
        { stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS },
        { stateObjectId: STATE_B, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: null },
      ],
    })
    expect(countGrantMoveCalls(tx, 'issue_to_grantee')).toBe(2)
  })
})

describe('buildBatchRevokeGrantsTx', () => {
  it('emits one grant::revoke call per item', () => {
    const tx = buildBatchRevokeGrantsTx({
      items: [
        { stateObjectId: STATE_A, granteeAddress: GRANTEE },
        { stateObjectId: STATE_B, granteeAddress: GRANTEE },
      ],
    })
    expect(countGrantMoveCalls(tx, 'revoke')).toBe(2)
  })

  it('rejects empty item list', () => {
    expect(() => buildBatchRevokeGrantsTx({ items: [] })).toThrow(/at least one entry/)
  })

  it('rejects an oversized batch', () => {
    const items = Array.from({ length: MAX_GRANT_BATCH_SIZE + 1 }, () => ({
      stateObjectId: STATE_A,
      granteeAddress: GRANTEE,
    }))
    expect(() => buildBatchRevokeGrantsTx({ items })).toThrow(/MAX_GRANT_BATCH_SIZE/)
  })

  it('rejects empty grantee address inside the batch', () => {
    expect(() =>
      buildBatchRevokeGrantsTx({
        items: [
          { stateObjectId: STATE_A, granteeAddress: '' },
        ],
      }),
    ).toThrow(/granteeAddress/)
  })
})

describe('addIssueGrantCalls / addSetGrantCapacityCalls injectors', () => {
  it('addIssueGrantCalls splices a single issue_to_grantee moveCall into an external PTB', () => {
    const tx = new Transaction()
    addIssueGrantCalls(tx, {
      stateObjectId: STATE_A,
      granteeAddress: GRANTEE,
      scopeMask: SOUL_GRANT_SCOPE_ASSETS,
      expiresAtMs: null,
    })
    const json = JSON.parse(JSON.stringify(tx.getData()))
    const moveCalls = (json?.commands ?? []).filter(
      (cmd: { MoveCall?: { module?: string; function?: string } }) =>
        cmd?.MoveCall?.module === 'grant' && cmd?.MoveCall?.function === 'issue_to_grantee',
    )
    expect(moveCalls).toHaveLength(1)
  })

  it('addIssueGrantCalls produces the same PTB shape as buildIssueGrantTx', () => {
    const params = {
      stateObjectId: STATE_A,
      granteeAddress: GRANTEE,
      scopeMask: SOUL_GRANT_SCOPE_ASSETS,
      expiresAtMs: null,
    } as const
    const standalone = buildIssueGrantTx(params)
    const spliced = new Transaction()
    addIssueGrantCalls(spliced, params)
    expect(JSON.parse(JSON.stringify(spliced.getData())).commands).toEqual(
      JSON.parse(JSON.stringify(standalone.getData())).commands,
    )
  })

  it('addIssueGrantCalls rejects past expiry, empty grantee, non-positive scope', () => {
    expect(() => addIssueGrantCalls(new Transaction(), {
      stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: 1,
    })).toThrow(/expiresAtMs/)
    expect(() => addIssueGrantCalls(new Transaction(), {
      stateObjectId: STATE_A, granteeAddress: '   ', scopeMask: SOUL_GRANT_SCOPE_ASSETS,
    })).toThrow(/granteeAddress/)
    expect(() => addIssueGrantCalls(new Transaction(), {
      stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: 0,
    })).toThrow(/scopeMask/)
  })

  it('addSetGrantCapacityCalls splices a single set_grant_capacity moveCall', () => {
    const tx = new Transaction()
    addSetGrantCapacityCalls(tx, { stateObjectId: STATE_A, capacity: 5 })
    const json = JSON.parse(JSON.stringify(tx.getData()))
    const moveCalls = (json?.commands ?? []).filter(
      (cmd: { MoveCall?: { module?: string; function?: string } }) =>
        cmd?.MoveCall?.module === 'grant' && cmd?.MoveCall?.function === 'set_grant_capacity',
    )
    expect(moveCalls).toHaveLength(1)
  })

  it('addSetGrantCapacityCalls produces the same PTB shape as buildSetGrantCapacityTx', () => {
    const params = { stateObjectId: STATE_A, capacity: 7 }
    const standalone = buildSetGrantCapacityTx(params)
    const spliced = new Transaction()
    addSetGrantCapacityCalls(spliced, params)
    expect(JSON.parse(JSON.stringify(spliced.getData())).commands).toEqual(
      JSON.parse(JSON.stringify(standalone.getData())).commands,
    )
  })

  it('addSetGrantCapacityCalls rejects non-positive / unsafe capacity', () => {
    expect(() => addSetGrantCapacityCalls(new Transaction(), { stateObjectId: STATE_A, capacity: 0 }))
      .toThrow(/capacity/)
    expect(() => addSetGrantCapacityCalls(new Transaction(), { stateObjectId: STATE_A, capacity: -1 }))
      .toThrow(/capacity/)
    expect(() => addSetGrantCapacityCalls(new Transaction(), { stateObjectId: STATE_A, capacity: Number.NaN }))
      .toThrow(/capacity/)
  })

  it('two injector calls in the same PTB compose linearly', () => {
    const tx = new Transaction()
    addSetGrantCapacityCalls(tx, { stateObjectId: STATE_A, capacity: 3 })
    addIssueGrantCalls(tx, {
      stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: null,
    })
    addIssueGrantCalls(tx, {
      stateObjectId: STATE_A, granteeAddress: GRANTEE, scopeMask: SOUL_GRANT_SCOPE_ASSETS, expiresAtMs: null,
    })
    const json = JSON.parse(JSON.stringify(tx.getData()))
    const grantModuleCalls = (json?.commands ?? []).filter(
      (cmd: { MoveCall?: { module?: string } }) => cmd?.MoveCall?.module === 'grant',
    )
    expect(grantModuleCalls).toHaveLength(3)
  })
})
