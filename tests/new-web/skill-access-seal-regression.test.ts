import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('skill access Seal regression guards', () => {
  it('builds approval tx bytes as TransactionKind for Seal decrypt', () => {
    const source = readSource('new-web/lib/soulidity/skill-access.ts')

    expect(source).toContain('onlyTransactionKind: true')
  })

  it('uses seal_approve-prefixed skills approval targets end to end', () => {
    const moveSource = readSource('move/soulidity/sources/skills.move')
    const routeSource = readSource('new-web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts')
    const agentRouteSource = readSource('new-web/app/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts')
    const typesSource = readSource('new-web/lib/soulidity/types.ts')
    const clientSource = readSource('new-web/lib/soulidity/skill-access.ts')

    expect(moveSource).toContain('entry fun seal_approve_private_read_owner(')
    expect(moveSource).toContain('entry fun seal_approve_private_read_granted_agent(')
    expect(routeSource).toContain("functionName: 'seal_approve_private_read_owner'")
    expect(routeSource).toContain("functionName: 'seal_approve_private_read_granted_agent'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_private_read_owner'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_private_read_granted_agent'")
    expect(typesSource).toContain("functionName: 'seal_approve_private_read_owner' | 'seal_approve_private_read_granted_agent'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_private_read_owner'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_private_read_granted_agent'")
  })
})
