import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { createRouteDefinitions, matchRoute } from '../../web/spa/routes'
const root = resolve(import.meta.dirname, '../..')
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'generated', 'dist', '.next', '.git'].includes(entry.name)) return []
    const full = join(path, entry.name); return entry.isDirectory() ? files(full) : entry.isFile() ? [full] : []
  })
}
function violations(source: string, path = 'source.tsx') {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), found = new Set<string>()
  const names = new Set(['CollectionDetailResponse', 'CollectionDetailStats', 'SoulCollectionAssetDetail', 'toSoulCollectionDetail'])
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && names.has(node.text)) found.add(node.text)
    const url = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateExpression(node)
      ? node.head.text + node.templateSpans.map(s => 'DYNAMIC_ID' + s.literal.text).join('') : null
    if (url && /^\/api\/collections\/(?!create(?:[?#]|$))[^/?#]+(?:[?#].*)?$/.test(url)) found.add('retired detail HTTP')
    ts.forEachChild(node, visit)
  }
  visit(ast); return [...found].sort()
}
it('removes only the replaced Collection detail route, DTO and dead converter from production', () => {
  expect(existsSync(join(root, 'web/app/api/collections/[id]/route.ts'))).toBe(false)
  const result = ['web/app', 'web/components', 'web/lib', 'web/spa', 'src', 'scripts', 'packages/soulidity-sdk/src', 'desktop']
    .flatMap(path => files(join(root, path))).filter(path => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path))
    .flatMap(path => violations(readFileSync(path, 'utf8'), path).map(reason => relative(root, path) + ': ' + reason))
  expect(result).toEqual([])
})
it('actual static routing retains Collection deep links and the authoring subroutes', () => {
  const modules = files(join(root, 'web/app')).map(path => '../app/' + relative(join(root, 'web/app'), path))
  const routes = createRouteDefinitions(modules.filter(path => /\/page\.tsx$/.test(path)), modules.filter(path => /\/layout\.tsx$/.test(path)))
  expect(matchRoute(routes, '/collections/0x123')?.route.page).toBe('../app/collections/[id]/page.tsx')
  expect(matchRoute(routes, '/collections/create')?.route.page).toBe('../app/collections/create/page.tsx')
  expect(matchRoute(routes, '/api/collections/0x123')).toBeNull()
})
it('detector handles template endpoints/aliased DTOs while excluding still-used mutation routes/comments', () => {
  expect(violations("import type { CollectionDetailResponse as C } from 'x';fetch(`/api/collections/${encodeURIComponent(id)}`)"))
    .toEqual(['CollectionDetailResponse', 'retired detail HTTP'])
  expect(violations("fetch('/api/collections/0x1?viewer=x')")).toEqual(['retired detail HTTP'])
  expect(violations("// CollectionDetailResponse /api/collections/0x1\nfetch(`/api/collections/${id}/purchase`);fetch('/api/collections/create');fetch(`/api/collections/${id}/add-soul`)"))
    .toEqual([])
})
