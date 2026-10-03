import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { createRouteDefinitions, matchRoute } from '../../web/spa/routes'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')
const retiredFiles = [
  'web/app/api/souls/route.ts', 'web/app/api/souls/route.test.ts', 'web/app/api/souls/query.ts',
  'web/app/api/souls/tags/route.ts', 'web/app/api/souls/tags/route.test.ts', 'web/app/api/souls/tags/cache.ts',
  'web/app/api/collections/route.ts',
]
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'generated', 'dist', 'dist-spa', '.next', '.git'].includes(entry.name)) return []
    const full = join(path, entry.name)
    return entry.isDirectory() ? files(full) : entry.isFile() ? [full] : []
  })
}
function retiredReferences(text: string, name = 'source.tsx') {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Set<string>(), retired = new Set(['SoulsListResponse', 'CollectionsListResponse'])
  const endpoint = /^(?:https?:\/\/[^/?#]+)?(\/api\/(?:souls(?:\/tags)?|collections))\/?(?:[?#]|$)/
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      // A `/api/collections/${id}` head or '/api/souls/' + id still serves
      // detail callers; it is not the removed exact list endpoint.
      const detailPrefix = node.text.endsWith('/') && (ts.isTemplateHead(node)
        || ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && node.parent.left === node)
      const match = !detailPrefix && endpoint.exec(node.text)
      if (match) found.add('retired endpoint ' + match[1])
    }
    if (ts.isIdentifier(node) && retired.has(node.text)) found.add('retired DTO ' + node.text)
    ts.forEachChild(node, visit)
  }
  visit(ast); return [...found].sort()
}
it('removes all seven replaced Market list/tag route, query/cache and route-test files', () => {
  expect(retiredFiles.filter(path => existsSync(join(root, path)))).toEqual([])
})
it('all production runtime callers and SDK declarations are free of retired exact list URLs and DTOs', () => {
  const violations = ['web/app', 'web/components', 'web/lib', 'web/spa', 'src', 'scripts', 'packages/soulidity-sdk/src', 'desktop']
    .flatMap(path => files(join(root, path))).filter(path => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path))
    .flatMap(path => {
      const text = readFileSync(path, 'utf8')
      if (!/SoulsListResponse|CollectionsListResponse|api\/souls|api\/collections/.test(text)) return []
      return retiredReferences(text, path).map(reason => relative(root, path) + ': ' + reason)
    })
  expect(violations).toEqual([])
})
it('actual SPA retains /market and original hook names forward directly to public Market', () => {
  const modules = files(join(root, 'web/app')).map(path => '../app/' + relative(join(root, 'web/app'), path))
  const routes = createRouteDefinitions(modules.filter(path => /\/page\.tsx$/.test(path)), modules.filter(path => /\/layout\.tsx$/.test(path)))
  expect(matchRoute(routes, '/market')?.route.page).toBe('../app/market/page.tsx')
  for (const url of ['/api/souls', '/api/souls/tags', '/api/collections']) expect(matchRoute(routes, url)).toBeNull()
  for (const [path, oldName, newName] of [
    ['web/lib/hooks/use-souls.ts', 'useSoulsList', 'usePublicSoulsMarket'],
    ['web/lib/hooks/use-collections.ts', 'useCollectionsList', 'usePublicCollectionsMarket'],
  ]) {
    const ast = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true)
    const forwarded = ast.statements.filter(ts.isExportDeclaration).find(node => node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(item => item.name.text === oldName && item.propertyName?.text === newName))
    expect(forwarded?.moduleSpecifier && ts.isStringLiteral(forwarded.moduleSpecifier) ? forwarded.moduleSpecifier.text : null).toBe('./use-public-market')
    expect(ast.statements.filter(ts.isFunctionDeclaration).some(node => node.name?.text === oldName)).toBe(false)
  }
})
it('AST detector covers aliases, full URLs and parameterized list URLs without rejecting comments or remaining detail/create routes', () => {
  expect(retiredReferences("import type { SoulsListResponse as S, CollectionsListResponse as C } from './sdk'; fetch('/api/souls?tag=x'); fetch(`https://example.com/api/souls/tags?q=${q}`); fetch('/api/collections/')"))
    .toEqual(['retired DTO CollectionsListResponse', 'retired DTO SoulsListResponse', 'retired endpoint /api/collections', 'retired endpoint /api/souls', 'retired endpoint /api/souls/tags'])
  expect(retiredReferences("// SoulsListResponse was /api/souls\nfetch(`/api/souls/${id}`); fetch('/api/souls/' + id); fetch('/api/souls/publish'); fetch(`/api/collections/${id}/buy`); fetch('/api/collections/create'); fetch('/api/souls/tags-extra')"))
    .toEqual([])
})
