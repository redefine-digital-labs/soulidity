import { createRequire } from 'node:module'

/** This workspace has JSDOM at runtime, but no root @types/jsdom package.
 * Describe only the actual browser surfaces these tests use; production code
 * remains checked against the DOM library, not a test-only ambient any module. */
export interface CollectionCommandTestDom {
  window: Pick<Window, 'document' | 'navigator' | 'localStorage' | 'close'> & {
    Storage: typeof Storage; Event: typeof Event; HTMLElement: typeof HTMLElement
  }
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => CollectionCommandTestDom
}
export function collectionCommandTestDom(url: string) {
  return new JSDOM('<!doctype html><html><body></body></html>', { url })
}
