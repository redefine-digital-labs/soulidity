import { describe, expect, it } from 'vitest'
import { parseReviewArchiveMarkdown } from '../../src/mcp/review-memory/markdown.js'

const FIXED_MARKDOWN = `# Fixed Findings — Batch 0

> Last updated: 2026-03-28

### [F-101] First fixed finding

**File**: \`web/lib/example.ts:10-15\`
**Severity**: medium
**Description**: Something broke.
**Suggested Fix**: Add the missing guard.
**Fixed in**: Added the missing guard.

---

### [F-102] Second fixed finding

**File**: \`web/lib/other.ts:20\`
**Severity**: low
**Description**: Another issue.
**Suggested Fix**: Use a safer parser.
\`\`\`ts
const value = parse(input)
\`\`\`
**Fixed in**: Switched to the safer parser and added a regression test.

---
`

describe('parseReviewArchiveMarkdown', () => {
  it('parses fixed archive files into structured findings', () => {
    const findings = parseReviewArchiveMarkdown({
      repo: 'clawnews',
      sourceFile: 'review/batch-0/fixed.md',
      content: FIXED_MARKDOWN,
      nowIso: '2026-03-28T00:00:00.000Z',
    })

    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({
      batchId: 'batch-0',
      resolutionType: 'fixed',
      localRecordId: 'F-101',
      title: 'First fixed finding',
      file: 'web/lib/example.ts',
      lineRef: '10-15',
      severity: 'medium',
      resolutionText: 'Added the missing guard.',
    })
    expect(findings[1]?.suggestedFix).toContain('const value = parse(input)')
  })

  it('parses not-issue records using the Reason field as resolution text', () => {
    const findings = parseReviewArchiveMarkdown({
      repo: 'clawnews',
      sourceFile: 'review/batch-3/not-issue.md',
      content: `# Not-Issue Findings — Batch 3

> Last updated: 2026-03-28

### [N-002] Already validated upstream

**File**: \`web/lib/auth.ts:45\`
**Severity**: low
**Description**: The value looked unchecked.
**Suggested Fix**: Add another guard.
**Reason**: False positive — upstream validation already rejects malformed values.

---
`,
      nowIso: '2026-03-28T00:00:00.000Z',
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      batchId: 'batch-3',
      resolutionType: 'not_issue',
      localRecordId: 'N-002',
      resolutionText: 'False positive — upstream validation already rejects malformed values.',
    })
  })

  it('preserves batch id when archive paths use review/archive/batch-0', () => {
    const findings = parseReviewArchiveMarkdown({
      repo: 'clawnews',
      sourceFile: 'review/archive/batch-0/fixed.md',
      content: FIXED_MARKDOWN,
      nowIso: '2026-03-28T00:00:00.000Z',
    })

    expect(findings).toHaveLength(2)
    expect(findings[0]?.batchId).toBe('batch-0')
    expect(findings[0]?.sourceFile).toBe('review/archive/batch-0/fixed.md')
  })
})
