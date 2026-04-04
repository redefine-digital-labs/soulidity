import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('new-web auth gating regression guards', () => {
  it('keeps the My Souls anonymous state wired to a Sign In action', () => {
    const source = readSource('new-web/app/my-souls/page.tsx')

    expect(source).toContain('actionLabel="Sign In"')
    expect(source).toContain('void login()')
  })

  it('keeps the Soul detail Buy CTA behind requireAuth interception', () => {
    const source = readSource('new-web/app/souls/[id]/page.tsx')

    expect(source).toContain('const { requireAuth } = useRequireAuth()')
    expect(source).toContain('router.push(`/souls/${encodeURIComponent(soulId)}/buy`)')
    expect(source).not.toContain('<Link href={`/souls/${encodeURIComponent(soulId)}/buy`}')
  })

  it('keeps the buy route gated for anonymous direct visits', () => {
    const source = readSource('new-web/app/souls/[id]/buy/page.tsx')

    expect(source).toContain('label="Sign in to purchase"')
    expect(source).toContain('actionLabel="Sign In"')
    expect(source).toContain('void login()')
  })

  it('keeps the wrap-link entry cards behind requireAuth interception', () => {
    const source = readSource('new-web/app/wrap-link/page.tsx')

    expect(source).toContain("router.push('/wrap-link/personal')")
    expect(source).toContain("router.push('/wrap-link/collection')")
    expect(source).toContain('const { requireAuth } = useRequireAuth()')
  })

  it('keeps sell, create, import, and wrap flows behind AuthGate layouts', () => {
    const files = [
      ['new-web/app/souls/[id]/sell/layout.tsx', 'Sign in to manage your Soul listing'],
      ['new-web/app/create/layout.tsx', 'Sign in to create a Soul'],
      ['new-web/app/import/layout.tsx', 'Sign in to import a Soul'],
      ['new-web/app/wrap-link/personal/layout.tsx', 'Sign in to start Personal Join'],
      ['new-web/app/wrap-link/collection/layout.tsx', 'Sign in to expand a collection'],
    ]

    for (const [file, label] of files) {
      const source = readSource(file)

      expect(source, file).toContain('<AuthGate')
      expect(source, file).toContain(`label="${label}"`)
    }
  })

  it('keeps the profile page behind an AuthGate prompt', () => {
    const source = readSource('new-web/app/profile/page.tsx')

    expect(source).toContain('label="Sign in to edit your profile"')
    expect(source).toContain('<AuthGate')
  })
})
