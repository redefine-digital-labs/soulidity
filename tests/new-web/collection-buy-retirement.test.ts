import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
function retired(source: string, filename = 'source.tsx') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true), found = new Set<string>()
  function value(node: ts.Node): string | null {
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => 'ID' + s.literal.text).join('')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return (value(node.left) ?? 'ID') + (value(node.right) ?? 'ID')
    return null
  }
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === 'useCollectionActions') found.add('retired hook')
    const text = value(node)
    if (text && /^\/api\/collections\/[^/?#]+\/(?:purchase|list)(?:[?#].*)?$/.test(text)) found.add('retired mutation HTTP')
    if (text && ['collection:buy', 'collection:list', 'collection:delist'].includes(text)) found.add('retired mirror key')
    ts.forEachChild(node, visit)
  }
  visit(ast); return [...found].sort()
}
it('removes replaced purchase/list routes and every production hook, HTTP caller and mirror key', () => {
  for (const route of ['purchase', 'list']) expect(existsSync(join(root, `web/app/api/collections/[id]/${route}/route.ts`))).toBe(false)
  const paths = execFileSync('rg', ['--files', 'web', 'packages/soulidity-sdk/src', 'src', 'scripts', 'desktop',
    '-g', '*.ts', '-g', '*.tsx', '-g', '*.js', '-g', '*.mjs', '-g', '!**/node_modules/**', '-g', '!**/dist/**', '-g', '!**/generated/**',
    '-g', '!**/*.test.*', '-g', '!**/*.spec.*'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  expect(paths.flatMap(path => retired(readFileSync(join(root, path), 'utf8'), path).map(reason => `${path}: ${reason}`))).toEqual([])
})
it('detects aliased hooks, template/concatenated endpoints and query strings without treating comments or remaining authoring as callers', () => {
  expect(retired("import {useCollectionActions as a} from 'x'; fetch(`/api/collections/${id}/purchase?mode=x`); const key='collection:buy'"))
    .toEqual(['retired hook', 'retired mirror key', 'retired mutation HTTP'])
  expect(retired("fetch('/api/collections/' + id + '/purchase')")).toEqual(['retired mutation HTTP'])
  expect(retired("// useCollectionActions /api/collections/id/purchase collection:buy\nfetch('/api/collections/create');fetch(`/api/collections/${id}/add-soul`);buildBuyCollectionTx(input)"))
    .toEqual([])
})
it('keeps the original detail purchase controls connected to durable query-first recovery', () => {
  const page = readFileSync(join(root, 'web/app/collections/[id]/page.tsx'), 'utf8')
  expect(page).toContain('useCollectionBuy(')
  expect(page).toContain('onBuy={() => setBuyOpen(true)}')
  expect(page).toContain('<CollectionPurchasePanel')
  expect(page).not.toContain('signAndExecuteTransaction')
  expect(existsSync(join(root, 'web/app/api/collections/create/route.ts'))).toBe(true)
  expect(existsSync(join(root, 'web/app/api/collections/[id]/add-soul/route.ts'))).toBe(true)
})
