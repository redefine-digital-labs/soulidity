import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = join(
  process.cwd(),
  'desktop/apps/desktop/src/renderer/components/MainWindow/styles.css',
)

const css = readFileSync(stylesPath, 'utf8')

describe('MainWindow styles', () => {
  it('marks tabs, tab buttons, and body as no-drag regions', () => {
    expect(css).toMatch(/\.main-window__tabs\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/)
    expect(css).toMatch(/\.main-window__tab\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/)
    expect(css).toMatch(/\.main-window__body\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/)
  })
})
