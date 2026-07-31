import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourcePath = path.resolve(
  process.cwd(),
  'web/app/integrations/animacraft/integration-client.tsx',
)
const source = fs.readFileSync(sourcePath, 'utf8')
const sourceFile = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function variableInitializer(name: string): ts.Expression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === name
        && declaration.initializer
      ) {
        return unwrapExpression(declaration.initializer)
      }
    }
  }
  throw new Error(`Missing ${name} in ${sourcePath}`)
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    !ts.isPropertyAssignment(property)
    && !ts.isShorthandPropertyAssignment(property)
  ) {
    return null
  }
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text
  }
  return null
}

function objectPropertyKeys(expression: ts.Expression): string[] {
  const object = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(object)) {
    throw new Error('Expected an object literal')
  }
  return object.properties
    .map(propertyName)
    .filter((name): name is string => Boolean(name))
}

describe('Animacraft Soulidity integration translations', () => {
  it('keeps exactly the five Animacraft locales with strict key parity', () => {
    const locales = variableInitializer('ANIMACRAFT_INTEGRATION_LOCALES')
    expect(ts.isArrayLiteralExpression(locales)).toBe(true)
    if (!ts.isArrayLiteralExpression(locales)) return
    expect(locales.elements.map((element) => element.getText(sourceFile).replaceAll("'", '')))
      .toEqual(['en', 'zh', 'ja', 'ko', 'vi'])

    const englishKeys = objectPropertyKeys(variableInitializer('EN_MESSAGES')).sort()
    const dictionaries = variableInitializer('ANIMACRAFT_INTEGRATION_MESSAGES')
    expect(ts.isObjectLiteralExpression(dictionaries)).toBe(true)
    if (!ts.isObjectLiteralExpression(dictionaries)) return

    const localeAssignments = dictionaries.properties.filter(ts.isPropertyAssignment)
    expect(localeAssignments.map(propertyName)).toEqual(['en', 'zh', 'ja', 'ko', 'vi'])
    for (const assignment of localeAssignments.slice(1)) {
      expect(objectPropertyKeys(assignment.initializer).sort()).toEqual(englishKeys)
    }
  })

  it('detects URL, stored, and browser locales with an English fallback', () => {
    expect(source).toContain('normalizeAnimacraftIntegrationLocale')
    expect(source).toContain("window.location.search).get('lang')")
    expect(source).toContain('ANIMACRAFT_INTEGRATION_LOCALE_KEY')
    expect(source).toContain('window.navigator.languages')
    expect(source).toContain("return 'en'")
    expect(source).toContain('window.history.replaceState')
  })

  it('routes handoff status, errors, and calls to action through the dictionary', () => {
    expect(source).toContain('formatAnimacraftIntegrationMessage')
    expect(source).toContain("t('mintChecking')")
    expect(source).toContain("t('technicalDetails')")
    expect(source).toContain("t('signCompletePrice'")
    expect(source).toContain("t('connectSuiWallet')")
    expect(source).toContain("t('backToAnimacraft')")
    expect(source).toContain('?lang=${encodeURIComponent(locale)}#make')
  })
})
