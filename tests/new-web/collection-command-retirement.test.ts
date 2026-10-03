import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
function retired(source: string, filename: string) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const result: string[] = []
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && ['useCollectionListing', 'CollectionListingStatus'].includes(node.text)) result.push(node.text)
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        const value = argument.getText(file)
        if (value.includes('/api/collections/') && /\/list(?:['"`/?}]|$)/.test(value)) result.push('retired listing HTTP path')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file); return result
}
it('retired mutation HTTP route and lightweight hook have no live production callers, including bundled Collection publication', () => {
  expect(existsSync(path.join(root, 'web/app/api/collections/[id]/list/route.ts'))).toBe(false)
  const files = execFileSync('rg', ['--files', 'web', '-g', '*.ts', '-g', '*.tsx', '-g', '!**/*.test.*', '-g', '!**/node_modules/**'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  const findings = files.flatMap(file => retired(readFileSync(path.join(root, file), 'utf8'), file).map(finding => `${file}: ${finding}`))
  expect(findings).toEqual([])
})
it('the scanner catches old hooks and dynamic POST callers, not legitimate collection reads or SDK builders', () => {
  expect(retired("import { useCollectionListing as old } from './use-collections'; old(c)", 'a.ts')).toContain('useCollectionListing')
  expect(retired('fetch(`/api/collections/${encodeURIComponent(id)}/list`, { method: "POST" })', 'a.ts')).toContain('retired listing HTTP path')
  expect(retired('http.post("/api/collections/0x123/list", packet)', 'a.ts')).toContain('retired listing HTTP path')
  expect(retired('fetch(`/api/collections/${id}/purchase`, options); buildListCollectionTx(input)', 'a.ts')).toEqual([])
  expect(retired('// useCollectionListing and /api/collections/old/list are retired\nfetch(`/api/collections/${id}`)', 'a.ts')).toEqual([])
})
it('keeps the original read hook imports without retaining dead command/create/purchase helpers', () => {
  const source = readFileSync(path.join(root, 'web/lib/hooks/use-collections.ts'), 'utf8')
  const ast = ts.createSourceFile('use-collections.ts', source, ts.ScriptTarget.Latest, true)
  const functions = ast.statements.filter(ts.isFunctionDeclaration)
  expect(functions).toHaveLength(0)
  expect(source).toContain('usePublicCollectionsMarket as useCollectionsList')
  expect(source).toContain("export { useCollectionDetail } from './use-collection-detail'")
})
