import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
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

/** Inspect syntax nodes, not comments, whitespace or large implementation text.
 * Runtime membership/payment/privacy behavior lives in the actual-render pages,
 * provider and controller suites; this suite only guards removed entry points. */
function retiredReferences(text: string, name = 'source.tsx') {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true,
    name.endsWith('.tsx') || name.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Set<string>()
  const oldHooks = new Set(['useBookmarks', 'useBookmarkStatus', 'useToggleBookmark'])
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\/api\/souls\/bookmark(?:[/?#]|$)/.test(node.text)) found.add('retired HTTP bookmark endpoint')
    if (ts.isIdentifier(node) && oldHooks.has(node.text)) found.add(`retired hook ${node.text}`)
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'bookmark'
      || ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
        && node.argumentExpression.text === 'bookmark') found.add('retired bookmark delegate')
    if (ts.isArrayLiteralExpression(node) && node.elements[0] && ts.isStringLiteralLike(node.elements[0])
      && node.elements[0].text === 'bookmarks') found.add('retired plaintext bookmark query key')
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return [...found].sort()
}

function prismaTokens(schema: string) {
  // Prisma model/type/relation identifiers and mapped table names are lexical
  // tokens. Comments cannot satisfy or fail this retired-model assertion.
  return [...schema.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[{}\[\]@?().,]/g)]
    .map(match => match[0]).filter(token => !token.startsWith('//') && !token.startsWith('/*'))
    .map(token => token.startsWith('"') ? JSON.parse(token) as string : token)
}

describe('private bookmark direct replacement', () => {
  it('removes the old HTTP route without leaving another bookmark API route', () => {
    expect(existsSync(join(root, 'web/app/api/souls/bookmark/route.ts'))).toBe(false)
    const restored = files(join(root, 'web/app/api'))
      .filter(path => /(?:^|\/)bookmarks?(?:\/|$)/i.test(relative(join(root, 'web/app/api'), path)) && /\/route\.[cm]?[jt]sx?$/.test(path))
      .map(path => relative(root, path))
    expect(restored).toEqual([])
  })

  it('has no SQL Bookmark model, relation field/type or mapped bookmarks table', () => {
    const tokens = prismaTokens(source('prisma/schema.prisma'))
    expect(tokens).toContain('Member'); expect(tokens).toContain('SoulAsset')
    expect(tokens.filter(token => token === 'Bookmark' || token === 'bookmarks')).toEqual([])
  })

  it('does not route retired bookmark HTTP URLs through the production SPA', () => {
    const modules = files(join(root, 'web/app')).map(path => `../app/${relative(join(root, 'web/app'), path)}`)
    const routes = createRouteDefinitions(modules.filter(path => /\/page\.tsx$/.test(path)), modules.filter(path => /\/layout\.tsx$/.test(path)))
    expect(matchRoute(routes, '/market')?.route.page).toBe('../app/market/page.tsx')
    expect(matchRoute(routes, '/my-souls')?.route.page).toBe('../app/my-souls/page.tsx')
    for (const retired of ['/api/souls/bookmark', '/api/souls/bookmark/', '/api/souls/bookmark/status'])
      expect(matchRoute(routes, retired)).toBeNull()
  })

  it('has no production caller, old bookmark hook or plaintext query-cache fallback', () => {
    const violations = ['web/app', 'web/components', 'web/lib', 'web/spa', 'src', 'packages/soulidity-sdk/src']
      .flatMap(path => files(join(root, path))).filter(path => /\.[cm]?[jt]sx?$/.test(path) && !/\.(?:test|spec)\.[jt]sx?$/.test(path))
      .flatMap(path => {
        const text = readFileSync(path, 'utf8')
        if (!/bookmark/i.test(text)) return []
        return retiredReferences(text, path).map(reason => `${relative(root, path)}: ${reason}`)
      })
    expect(violations).toEqual([])
  })

  it('actually detects renamed hook imports, computed delegates, endpoint constants and cache prefixes', () => {
    expect(retiredReferences(`
      import { useBookmarks as useSaved } from './use-social';
      const endpoint = '/api/souls/bookmark?owner=wallet';
      fetch(endpoint); db['bookmark'].deleteMany({});
      queryClient.invalidateQueries({ queryKey: ['bookmarks', wallet] });
    `)).toEqual(['retired HTTP bookmark endpoint', 'retired bookmark delegate',
      'retired hook useBookmarks', 'retired plaintext bookmark query key'])
  })

  it('does not mistake historical comments or the preserved private Bookmarks tab for legacy callers', () => {
    expect(retiredReferences(`
      // useBookmarks called /api/souls/bookmark in the retired implementation.
      const tabs = [{ id: 'bookmarks', label: 'Bookmarks' }];
      const actions = usePrivateBookmarks();
      actions.setBookmark(soul.onChainId, false);
      const unrelated = '/api/souls/bookmarker';
    `)).toEqual([])
    expect(prismaTokens('// model Bookmark { }\nmodel Member { id String } /* bookmarks */')).not.toContain('Bookmark')
    expect(prismaTokens('model Renamed { rows Bookmark[] @@map("bookmarks") }')).toContain('Bookmark')
    expect(prismaTokens('model Renamed { rows Bookmark[] @@map("bookmarks") }')).toContain('bookmarks')
  })
})
