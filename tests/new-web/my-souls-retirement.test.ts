import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { createRouteDefinitions, matchRoute } from '../../web/spa/routes'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'generated', 'dist', '.next', '.git'].includes(entry.name)) return []
    const full = join(path, entry.name)
    return entry.isDirectory() ? files(full) : entry.isFile() ? [full] : []
  })
}
function retiredReferences(text: string, name = 'source.tsx') {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Set<string>()
  const retired = new Set(['MySoulActiveGrant', 'MySoulEntry', 'MySoulsResponse', 'SoulPurchaseActivity'])
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\/api\/souls\/my(?:[/?#]|$)/.test(node.text)) found.add('retired portfolio endpoint')
    if (ts.isIdentifier(node) && retired.has(node.text)) found.add('retired DTO ' + node.text)
    ts.forEachChild(node, visit)
  }
  visit(ast); return [...found].sort()
}
it('removes the retired SQL aggregation route and its unsupported DTOs from all production callers', () => {
  expect(existsSync(join(root, 'web/app/api/souls/my/route.ts'))).toBe(false)
  const violations = ['web/app', 'web/components', 'web/lib', 'web/spa', 'src', 'scripts', 'packages/soulidity-sdk/src', 'desktop']
    .flatMap(path => files(join(root, path))).filter(path => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path))
    .flatMap(path => {
      const text = readFileSync(path, 'utf8')
      if (!/MySoul|SoulPurchaseActivity|souls\/my/.test(text)) return []
      return retiredReferences(text, path).map(reason => relative(root, path) + ': ' + reason)
    })
  expect(violations).toEqual([])
})
it('the actual SPA keeps the original portfolio route but has no old HTTP aggregation route', () => {
  const modules = files(join(root, 'web/app')).map(path => '../app/' + relative(join(root, 'web/app'), path))
  const routes = createRouteDefinitions(modules.filter(path => /\/page\.tsx$/.test(path)), modules.filter(path => /\/layout\.tsx$/.test(path)))
  expect(matchRoute(routes, '/my-souls')?.route.page).toBe('../app/my-souls/page.tsx')
  for (const url of ['/api/souls/my', '/api/souls/my/', '/api/souls/my/anything']) expect(matchRoute(routes, url)).toBeNull()
})
it('the existing hook import forwards to the new wallet-only module without another aggregation implementation', () => {
  const ast = ts.createSourceFile('use-souls.ts', source('web/lib/hooks/use-souls.ts'), ts.ScriptTarget.Latest, true)
  const forward = ast.statements.filter(ts.isExportDeclaration).find(node => node.exportClause
    && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(item => item.name.text === 'useMySouls'))
  expect(forward?.moduleSpecifier && ts.isStringLiteral(forward.moduleSpecifier) ? forward.moduleSpecifier.text : null).toBe('./use-my-souls')
  expect(ast.statements.filter(ts.isFunctionDeclaration).some(node => node.name?.text === 'useMySouls')).toBe(false)
})
it('the retirement detector catches aliases and runtime endpoint literals, not comments or similar routes', () => {
  expect(retiredReferences("import type { MySoulsResponse as Rows } from './sdk'; const route = '/api/souls/my?wallet=0x1'"))
    .toEqual(['retired DTO MySoulsResponse', 'retired portfolio endpoint'])
  expect(retiredReferences("// MySoulsResponse was /api/souls/my\nconst route = '/api/souls/mystery'; const data: MySoulsPortfolio = current"))
    .toEqual([])
})
