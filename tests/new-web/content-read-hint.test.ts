import { expect, it } from 'vitest'
import { canAttemptContentRead } from '../../web/lib/soulidity/content-read-hint'
const slot = { soulOnChainId: 'soul', contentOnChainId: 'content', deleted: false, purged: false, kind: 3, readModeMask: 15, grantScopeMask: 8 } as any
const soul = { onChainId: 'soul', contentOnChainId: 'content', currentOwnerAddress: 'owner', currentOwnershipEpoch: '3',
  activeGrants: [{ granteeAddress: 'grant', scopeMask: 9, status: 'active', ownershipEpochSnapshot: '3' }],
  paidAccessEntries: [{ buyerAddress: 'paid', kind: 3, scopeMask: 8, currentEpoch: true, unexpiredAtObservation: true, ownershipEpochSnapshot: '3' }] } as any
it.each(['owner', 'grant', 'paid', null])('offers %s a current read-channel attempt', viewer => {
  expect(canAttemptContentRead(soul, { ...slot, readModeMask: viewer === null ? 8 : 7 }, viewer)).toBe(true)
})
it.each(['deleted', 'purged', 'wrong-soul', 'wrong-content', 'no-public', 'wrong-scope', 'zero-scope', 'expired', 'epoch', 'no-owner-mask'])('does not advertise invalid %s hints', mode => {
  const s = structuredClone(soul), v = { ...slot, readModeMask: 7 }; let viewer: string | null = 'paid'
  if (mode === 'deleted') v.deleted = true
  if (mode === 'purged') v.purged = true
  if (mode === 'wrong-soul') v.soulOnChainId = 'other'
  if (mode === 'wrong-content') v.contentOnChainId = 'other'
  if (mode === 'no-public') viewer = null
  if (mode === 'wrong-scope') s.paidAccessEntries[0].scopeMask = 1
  if (mode === 'zero-scope') v.grantScopeMask = 0
  if (mode === 'expired') s.paidAccessEntries[0].unexpiredAtObservation = false
  if (mode === 'epoch') s.currentOwnershipEpoch = '4'
  if (mode === 'no-owner-mask') { v.readModeMask = 6; viewer = 'owner' }
  expect(canAttemptContentRead(s, v, viewer)).toBe(false)
})
