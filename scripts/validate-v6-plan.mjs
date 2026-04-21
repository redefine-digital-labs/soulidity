#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const docPath = resolve('docs/specs/2026-04-21-desktop-version-fusion-optimization/V6.md')
const jsonPath = resolve('docs/specs/2026-04-21-desktop-version-fusion-optimization/v6.plan.json')

const VALID_TEAMS = new Set(['desktop-main', 'desktop-renderer', 'desktop-backend', 'qa'])
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2'])

function fail(message) {
  console.error(`V6 校验失败: ${message}`)
  process.exit(1)
}

if (!existsSync(docPath)) fail('缺少 V6.md')
if (!existsSync(jsonPath)) fail('缺少 v6.plan.json')

const doc = readFileSync(docPath, 'utf8')
const requiredSections = [
  '## Step 1：分析 4 个版本（融合输入）',
  '## Step 2：决策',
  '## Step 3：融合优化',
  '## Step 4：最终版本（完整代码）',
  '## Step 5：自我验证',
  '## Step 6：自动验证',
  '## Step 7：commit message + PR 描述',
  '## Step 8：经验沉淀',
  '## Codex critique V5 -> V6',
]

for (const section of requiredSections) {
  if (!doc.includes(section)) fail(`V6.md 缺少章节: ${section}`)
}

let plan
try {
  plan = JSON.parse(readFileSync(jsonPath, 'utf8'))
} catch (error) {
  fail(`v6.plan.json 解析失败: ${error instanceof Error ? error.message : String(error)}`)
}

if (plan.version !== 'v6') fail('version 必须是 v6')
if (plan.principle !== 'stability-first-no-tail') fail('principle 必须是 stability-first-no-tail')
if (!Array.isArray(plan.milestones) || plan.milestones.length < 3) fail('milestones 至少 3 项')

const ids = new Set()
const graph = new Map()

for (const milestone of plan.milestones) {
  if (typeof milestone.id !== 'string' || milestone.id.trim().length < 3) fail('milestone.id 非法')
  if (ids.has(milestone.id)) fail(`重复 milestone.id: ${milestone.id}`)
  ids.add(milestone.id)

  if (!VALID_PRIORITIES.has(milestone.priority)) fail(`priority 非法: ${milestone.id}`)
  if (typeof milestone.summary !== 'string' || milestone.summary.trim().length === 0) {
    fail(`summary 不能为空: ${milestone.id}`)
  }

  if (!Array.isArray(milestone.owners) || milestone.owners.length === 0) fail(`owners 不能为空: ${milestone.id}`)
  for (const owner of milestone.owners) {
    if (!owner || typeof owner !== 'object') fail(`owner 非法: ${milestone.id}`)
    if (!VALID_TEAMS.has(owner.team)) fail(`owner.team 非法: ${milestone.id}`)
    if (typeof owner.role !== 'string' || owner.role.trim().length === 0) fail(`owner.role 不能为空: ${milestone.id}`)
  }

  if (!Array.isArray(milestone.acceptance) || milestone.acceptance.length === 0) fail(`acceptance 不能为空: ${milestone.id}`)
  if (milestone.acceptance.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    fail(`acceptance 项不能为空: ${milestone.id}`)
  }

  if (typeof milestone.rollback !== 'string' || milestone.rollback.trim().length === 0) fail(`rollback 不能为空: ${milestone.id}`)

  if (!Array.isArray(milestone.targetFiles) || milestone.targetFiles.length === 0) {
    fail(`targetFiles 不能为空: ${milestone.id}`)
  }

  for (const file of milestone.targetFiles) {
    if (typeof file !== 'string' || file.trim().length === 0) fail(`targetFiles 项非法: ${milestone.id}`)
    if (!existsSync(resolve(file))) fail(`targetFiles 不存在: ${milestone.id} -> ${file}`)
  }

  const deps = Array.isArray(milestone.dependsOn) ? milestone.dependsOn : []
  if (deps.includes(milestone.id)) fail(`dependsOn 不能依赖自己: ${milestone.id}`)
  graph.set(milestone.id, deps)
}

for (const [id, deps] of graph.entries()) {
  for (const dep of deps) {
    if (!ids.has(dep)) fail(`dependsOn 指向不存在 milestone: ${id} -> ${dep}`)
  }
}

const visiting = new Set()
const visited = new Set()

function dfs(id) {
  if (visiting.has(id)) fail(`dependsOn 存在环依赖: ${id}`)
  if (visited.has(id)) return
  visiting.add(id)
  for (const dep of graph.get(id) ?? []) dfs(dep)
  visiting.delete(id)
  visited.add(id)
}

for (const id of ids) dfs(id)

console.log('V6 文档与计划校验通过。')
