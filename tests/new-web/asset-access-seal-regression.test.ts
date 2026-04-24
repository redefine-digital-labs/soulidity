import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('asset access Seal regression guards', () => {
  it('builds approval tx bytes as TransactionKind for Seal decrypt', () => {
    const source = readSource('web/lib/soulidity/asset-access.ts')

    expect(source).toContain('onlyTransactionKind: true')
  })

  it('uses seal_approve-prefixed assets approval targets end to end', () => {
    const moveSource = readSource('move/soulidity/sources/assets.move')
    const contentAccessMoveSource = readSource('move/soulidity/sources/content_access.move')
    const resolverSource = readSource('web/lib/soulidity/asset-version-access.ts')
    const agentRouteSource = readSource('web/app/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts')
    const typesSource = readSource('web/lib/soulidity/types.ts')
    const clientSource = readSource('web/lib/soulidity/asset-access.ts')

    expect(moveSource).toContain('entry fun seal_approve_asset_read_owner(')
    expect(moveSource).toContain('entry fun seal_approve_asset_read_granted_agent(')
    expect(contentAccessMoveSource).toContain('entry fun seal_approve_asset_allowlisted(')
    expect(resolverSource).toContain("functionName: 'seal_approve_asset_read_owner'")
    expect(resolverSource).toContain("functionName: 'seal_approve_asset_read_granted_agent'")
    expect(resolverSource).toContain("functionName: 'seal_approve_asset_allowlisted'")
    expect(resolverSource).toContain("moduleName: 'content_access'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_asset_read_owner'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_asset_read_granted_agent'")
    expect(agentRouteSource).toContain("functionName: 'seal_approve_asset_allowlisted'")
    expect(typesSource).toContain("| 'seal_approve_asset_allowlisted'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_asset_read_owner'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_asset_read_granted_agent'")
    expect(clientSource).toContain("payload.accessPolicy.functionName === 'seal_approve_asset_allowlisted'")
    expect(clientSource).toContain("params.access.accessPolicy.moduleName === 'content_access'")
  })

  it('appends the Clock object when building seal_approve_asset_allowlisted PTBs', () => {
    const clientSource = readSource('web/lib/soulidity/asset-access.ts')
    const desktopClientSource = readSource('desktop/apps/desktop/src/renderer/lib/soulidity/asset-access.ts')

    expect(clientSource).toMatch(
      /functionName === 'seal_approve_asset_allowlisted'[\s\S]*?tx\.object\(SUI_CLOCK_OBJECT_ID\)/,
    )
    expect(desktopClientSource).toMatch(
      /functionName === 'seal_approve_asset_allowlisted'[\s\S]*?tx\.object\(SUI_CLOCK_OBJECT_ID\)/,
    )
  })
})
