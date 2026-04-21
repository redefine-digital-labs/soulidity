import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopImprovementPlanV6,
  type DesktopImprovementPlanV6,
} from '../../desktop/packages/shared/src/plans/desktop-improvement-v6'

describe('desktopImprovementPlanV6', () => {
  it('contains at least 3 milestones with unique ids', () => {
    expect(desktopImprovementPlanV6.version).toBe('v6')
    expect(desktopImprovementPlanV6.principle).toBe('stability-first-no-tail')
    expect(desktopImprovementPlanV6.milestones.length).toBeGreaterThanOrEqual(3)

    const ids = new Set(desktopImprovementPlanV6.milestones.map((m) => m.id))
    expect(ids.size).toBe(desktopImprovementPlanV6.milestones.length)
  })

  it('ensures all target files exist', () => {
    for (const milestone of desktopImprovementPlanV6.milestones) {
      for (const target of milestone.targetFiles) {
        expect(existsSync(resolve(target))).toBe(true)
      }
    }
  })

  it('ensures dependsOn references existing milestones and no self dependency', () => {
    const ids = new Set(desktopImprovementPlanV6.milestones.map((m) => m.id))
    for (const milestone of desktopImprovementPlanV6.milestones) {
      expect(milestone.dependsOn.includes(milestone.id)).toBe(false)
      for (const dep of milestone.dependsOn) {
        expect(ids.has(dep)).toBe(true)
      }
    }
  })
})

describe('v6.plan.json', () => {
  it('stays fully aligned with typed plan', () => {
    const jsonPath = resolve('docs/specs/2026-04-21-desktop-version-fusion-optimization/v6.plan.json')
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as DesktopImprovementPlanV6
    expect(parsed).toEqual(desktopImprovementPlanV6)
  })
})
