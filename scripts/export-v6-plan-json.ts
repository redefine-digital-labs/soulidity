import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { desktopImprovementPlanV6 } from '../desktop/packages/shared/src/plans/desktop-improvement-v6'

const outputPath = resolve('docs/specs/2026-04-21-desktop-version-fusion-optimization/v6.plan.json')
const serialized = `${JSON.stringify(desktopImprovementPlanV6, null, 2)}\n`
const checkOnly = process.argv.includes('--check')

if (checkOnly) {
  try {
    const current = readFileSync(outputPath, 'utf8')
    if (current !== serialized) {
      console.error('v6.plan.json 与 TS 计划不一致，请运行: npm run sync:v6-plan')
      process.exit(1)
    }
  } catch {
    console.error('v6.plan.json 缺失，请运行: npm run sync:v6-plan')
    process.exit(1)
  }
  console.log('v6.plan.json 与 TS 计划一致。')
  process.exit(0)
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, serialized, 'utf8')
console.log(`已更新: ${outputPath}`)
