import ts from 'typescript'
import type { Plugin } from 'vite'

export const SERVER_METADATA_LAYOUTS = new Set([
  'app/collections/[id]/layout.tsx', 'app/souls/[id]/layout.tsx',
  'app/community/u/[spaceId]/layout.tsx', 'app/community/posts/[id]/layout.tsx',
])

/** Preserve the actual default renderer. Do not stub Prisma or discard a provider. */
export function browserMetadataLayout(source: string, path: string): string {
  if (!SERVER_METADATA_LAYOUTS.has(path)) return source
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const defaults = file.statements.filter(statement => ts.isFunctionDeclaration(statement)
    && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword))
  const component = defaults[0]
  if (defaults.length !== 1 || !component || !ts.isFunctionDeclaration(component)
    || component.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    || component.body?.statements.length !== 1
    || !ts.isReturnStatement(component.body.statements[0])
    || !component.body.statements[0].expression
    || !ts.isIdentifier(component.body.statements[0].expression)
    || component.body.statements[0].expression.text !== 'children') {
    throw new Error('SPA metadata split needs explicit review; never discard layout behavior: ' + path)
  }
  return component.getText(file)
}

export function assertBrowserModule(source: string, path: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)
      && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      && statement.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      throw new Error('SPA requires a real client conversion of async page/layout: ' + path)
    }
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
      && ts.isStringLiteral(statement.moduleSpecifier)
      && /^(?:server-only$|next\/(?:server|headers)$|node:|@prisma\/|@db\/)/.test(statement.moduleSpecifier.text)) {
      throw new Error('Server-only import blocks SPA: ' + path + ' → ' + statement.moduleSpecifier.text)
    }
  }
  const privateReads = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)]
    .map(match => match[1]).filter(key => key !== 'NODE_ENV' && !key.startsWith('NEXT_PUBLIC_'))
  if (privateReads.length) throw new Error('Non-public environment dependency blocks SPA: ' + path + ' → ' + [...new Set(privateReads)].join(', '))
}

export function spaBrowserBoundary(root: string): Plugin {
  return {
    name: 'soulidity-spa-browser-boundary', enforce: 'pre',
    transform(source, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(root + '/') || file.includes('/node_modules/') || !/\.[jt]sx?$/.test(file)) return
      const path = file.slice(root.length + 1)
      const code = browserMetadataLayout(source, path)
      assertBrowserModule(code, path)
      return code === source ? null : { code, map: null }
    },
  }
}
