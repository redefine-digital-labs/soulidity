import { describe, expect, it } from 'vitest'
import {
  buildReviewMemoryRecord,
  computeFindingFingerprint,
  normalizeFindingText,
  parseFindingFileReference,
} from '../../src/mcp/review-memory/record.js'

const BASE_FINDING = {
  repo: 'clawnews',
  batchId: 'batch-0',
  resolutionType: 'fixed' as const,
  localRecordId: 'F-001',
  title: 'Null currentKioskId causes purchase quote failure',
  file: 'web/app/api/souls/[id]/route.ts',
  lineRef: '42',
  severity: 'medium',
  description: 'The route calls getSoulPurchaseQuote without guarding currentKioskId.',
  suggestedFix: 'Guard currentKioskId before quote lookup.',
  resolutionText: 'Added a currentKioskId guard before purchase quote lookup.',
  sourceFile: 'review/batch-0/fixed.md',
  sourceSectionId: 'F-001',
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
}

describe('review-memory record helpers', () => {
  it('normalizes finding text for stable hashing and search', () => {
    expect(normalizeFindingText('  Null   currentKioskId\nCAUSES\tFailure  ')).toBe(
      'null currentkioskid causes failure',
    )
  })

  it('parses file references into file path and line ref', () => {
    expect(parseFindingFileReference('`web/app/api/souls/[id]/route.ts:42-51`')).toEqual({
      file: 'web/app/api/souls/[id]/route.ts',
      lineRef: '42-51',
    })

    expect(parseFindingFileReference('`Multiple Move source files`')).toEqual({
      file: 'Multiple Move source files',
      lineRef: null,
    })
  })

  it('computes a broader fingerprint that ignores local record numbering', () => {
    const first = computeFindingFingerprint({
      repo: BASE_FINDING.repo,
      file: BASE_FINDING.file,
      title: BASE_FINDING.title,
      description: BASE_FINDING.description,
    })
    const second = computeFindingFingerprint({
      repo: BASE_FINDING.repo,
      file: BASE_FINDING.file,
      title: BASE_FINDING.title,
      description: `${BASE_FINDING.description} Extra detail that should not change the problem kind.`,
    })

    expect(first).toBe(second)
  })

  it('builds stable record ids that do not depend on local archive numbering', () => {
    const first = buildReviewMemoryRecord(BASE_FINDING)
    const second = buildReviewMemoryRecord({
      ...BASE_FINDING,
      localRecordId: 'F-999',
      sourceSectionId: 'F-999',
      resolutionText: 'Added a currentKioskId guard before purchase quote lookup.',
    })

    expect(first.uid).toBe(second.uid)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.searchText).toContain(BASE_FINDING.title)
    expect(first.searchText).toContain(BASE_FINDING.description)
  })
})
