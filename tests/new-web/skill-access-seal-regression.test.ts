import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('skill access Seal regression guards', () => {
  it('builds approval tx bytes as TransactionKind for Seal decrypt', () => {
    const source = readSource('web/lib/soulidity/skill-access.ts')

    expect(source).toContain('onlyTransactionKind: true')
  })

  it('uses seal_approve-prefixed skills approval targets end to end', () => {
    const moveSource = readSource('move/soulidity/sources/skills.move')
    const contentAccessMoveSource = readSource('move/soulidity/sources/content_access.move')
    const routeSource = readSource('web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts')
    const agentRouteSource = readSource('web/app/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts')
    const typesSource = readSource('web/lib/soulidity/types.ts')
    const clientSource = readSource('web/lib/soulidity/skill-access.ts')

    expect(moveSource).toContain('entry fun seal_approve_private_read_owner(')
    expect(moveSource).toContain('entry fun seal_approve_private_read_granted_agent(')
    expect(contentAccessMoveSource).toContain('entry fun seal_approve_skill_allowlisted(')
    expect(routeSource).toContain("functionName: 'seal_approve_private_read_owner'")
    expect(routeSource).toContain("functionName: 'seal_approve_private_read_granted_agent'")
    expect(routeSource).toContain("functionName: 'seal_approve_skill_allowlisted'")
    expect(routeSource).toContain("moduleName: 'content_access'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_private_read_owner'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_private_read_granted_agent'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_skill_allowlisted'")
    expect(agentRouteSource).toContain("moduleName: 'content_access'")
    expect(typesSource).toContain("| 'seal_approve_skill_allowlisted'")
    expect(typesSource).toContain("moduleName: 'skills' | 'content_access'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_private_read_owner'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_private_read_granted_agent'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_skill_allowlisted'")
    expect(clientSource).toContain("params.access.accessPolicy.moduleName === 'content_access'")
  })
})
