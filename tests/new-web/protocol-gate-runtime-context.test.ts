import { expect, it } from 'vitest'
import { parseSoulAccessDeployment } from '../../web/lib/soulidity/soul-access-plan'
import { parseSoulAuthoringTarget } from '../../web/lib/soulidity/soul-authoring-manifest'
import { soulAccessFixtureState, accessId } from './fixtures/soul-access-transaction'
import { soulAuthoringRequestFixture } from './fixtures/soul-authoring'

it('captures the gate in the strict access deployment and rejects missing or empty ids', () => {
  const deployment = { ...soulAccessFixtureState().deployment, protocolGateId: accessId(9001) }
  expect(parseSoulAccessDeployment(deployment).protocolGateId).toBe(deployment.protocolGateId)
  const { protocolGateId: _, ...missing } = deployment
  expect(() => parseSoulAccessDeployment(missing)).toThrow()
  expect(() => parseSoulAccessDeployment({ ...deployment, protocolGateId: '' })).toThrow()
})

it('captures the gate in the strict authoring target and rejects missing or empty ids', () => {
  const target = { ...soulAuthoringRequestFixture(accessId(9100)).target, protocolGateId: accessId(9002) }
  expect(parseSoulAuthoringTarget(target).protocolGateId).toBe(target.protocolGateId)
  const { protocolGateId: _, ...missing } = target
  expect(() => parseSoulAuthoringTarget(missing)).toThrow()
  expect(() => parseSoulAuthoringTarget({ ...target, protocolGateId: '' })).toThrow()
})
