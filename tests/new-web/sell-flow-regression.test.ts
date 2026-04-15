import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('sell flow regression guards', () => {
  it('redirects to sell success from a stable route id after listing completes', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain("if (status !== 'done') return")
    expect(source).toContain("router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)")
    expect(source).not.toContain("if (status === 'done' && soul)")
  })

  it('blocks zero-price listings from reaching authorization from the sell page', () => {
    const source = readSource('web/app/souls/[id]/sell/page.tsx')

    expect(source).toContain('const invalidPrice = priceAtomic != null && priceAtomic <= 0n')
    expect(source).toContain('const authorizeHref = priceAtomic != null && priceAtomic > 0n && !belowFloor')
  })

  it('treats 0 as an invalid price on the authorize page', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain('if (priceAtomic == null || priceAtomic <= 0n || priceError)')
  })

  it('blocks zero-price repricing in the listing modal before signing', () => {
    const source = readSource('web/components/souls/listing-modals.tsx')

    expect(source).toContain('const invalidPrice = priceAtomic != null && priceAtomic <= 0n')
    expect(source).toContain('if (priceAtomic == null || priceAtomic <= 0n || !soul.listingObjectOnChainId) return')
    expect(source).toContain('Listing price must be greater than 0')
    expect(source).toContain("disabled={priceAtomic == null || invalidPrice || !!priceError || samePrice || belowFloor || status !== 'idle'}")
  })
})
