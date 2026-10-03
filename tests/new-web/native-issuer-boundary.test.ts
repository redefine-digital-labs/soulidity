import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

// Replaces the deleted hook's obsolete V5 source-order assertion. Native
// pre-storage/quote/balance journeys belong to Animacraft; this test proves only
// that Soulidity does not keep a second mint flow, not financial E2E acceptance.
it('has no retired Web issuer or wardrobe fallback in the application source graph', () => {
  expect(existsSync('web/lib/hooks/use-animacraft-mint.ts')).toBe(false)
  expect(existsSync('web/components/souls/physical-wardrobe-v7.tsx')).toBe(false)
  for (const path of ['web/app', 'web/components', 'web/lib'].flatMap(sources)) {
    expect(readFileSync(path, 'utf8'), path).not.toMatch(/\b(?:useAnimacraftMint|buildMintAnimacraftSoulTx|simulateAnimacraftCompleteQuoteV5|buildAnimacraftCompleteOutputSealApprovalTx|physicalWardrobeV7RuntimeFromPublicEnv)\b/)
  }
})

it('retains the native completion adapter and receive-only account handoff', () => {
  const native = readFileSync('packages/soulidity-sdk/src/tx/animacraft-v8.ts', 'utf8')
  const receiver = readFileSync('web/app/integrations/animacraft/integration-client.tsx', 'utf8')
  expect(native).toContain('::market::mint_animacraft_v8_in_personal_kiosk')
  expect(receiver).toContain('receiveNativeRequest')
  expect(receiver).toContain('useLogin()')
  expect(receiver).not.toContain('signAndExecute')
})
