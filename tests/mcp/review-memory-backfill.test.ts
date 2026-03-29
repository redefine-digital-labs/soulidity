import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findLatestReviewBatchDir,
  runReviewMemoryBackfill,
} from '../../src/mcp/review-memory/backfill.js'
import type { ReviewMemoryRecord } from '../../src/mcp/review-memory/types.js'

describe('runReviewMemoryBackfill', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map(async () => {}))
  })

  it('finds the numerically latest batch directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-memory-batches-'))
    tempDirs.push(root)
    await mkdir(join(root, 'review', 'batch-2'), { recursive: true })
    await mkdir(join(root, 'review', 'batch-10'), { recursive: true })
    await mkdir(join(root, 'review', 'batch-7'), { recursive: true })

    const latest = await findLatestReviewBatchDir(join(root, 'review'))

    expect(latest?.replaceAll('\\', '/')).toBe(join(root, 'review', 'batch-10').replaceAll('\\', '/'))
  })

  it('replays archive files idempotently across repeated executions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-memory-backfill-'))
    tempDirs.push(root)
    const batchDir = join(root, 'review', 'batch-0')
    await mkdir(batchDir, { recursive: true })

    await writeFile(join(batchDir, 'fixed.md'), `# Fixed Findings — Batch 0

> Last updated: 2026-03-28

### [F-001] First fixed finding

**File**: \`web/lib/example.ts:10\`
**Severity**: medium
**Description**: Something broke.
**Suggested Fix**: Add the missing guard.
**Fixed in**: Added the missing guard.

---
`)

    await writeFile(join(batchDir, 'not-issue.md'), `# Not-Issue Findings — Batch 0

> Last updated: 2026-03-28

### [N-001] False positive finding

**File**: \`web/lib/other.ts:20\`
**Severity**: low
**Description**: Looked unsafe.
**Suggested Fix**: Add another guard.
**Reason**: False positive — already validated upstream.

---
`)

    await writeFile(join(batchDir, 'todo.md'), `# Todo Findings — Batch 0

> Last updated: 2026-03-28

### [T-001] Needs product decision

**File**: \`web/lib/product.ts:30\`
**Severity**: medium
**Description**: Needs a contract decision.
**Suggested Fix**: Ask product.
**Reason**: Public API decision required.

---
`)

    const seen = new Map<string, ReviewMemoryRecord>()
    const recordResolution = vi.fn(async ({ record }: { record: ReviewMemoryRecord }) => {
      const operation = seen.has(record.uid) ? 'updated' : 'created'
      seen.set(record.uid, record)
      return { uid: record.uid, operation, storedAt: record.updatedAt }
    })

    const first = await runReviewMemoryBackfill({
      repo: 'clawnews',
      batchDir,
      nowIso: '2026-03-28T00:00:00.000Z',
      recordResolution,
    })
    const second = await runReviewMemoryBackfill({
      repo: 'clawnews',
      batchDir,
      nowIso: '2026-03-28T00:00:00.000Z',
      recordResolution,
    })

    expect(first).toMatchObject({
      processed: 3,
      created: 3,
      updated: 0,
    })
    expect(second).toMatchObject({
      processed: 3,
      created: 0,
      updated: 3,
    })
    expect(seen.size).toBe(3)
  })

  it('normalizes sourceFile to review/batch-0 paths even when batchDir is outside cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-memory-external-backfill-'))
    tempDirs.push(root)
    const batchDir = join(root, 'some', 'nested', 'repo', 'review', 'batch-0')
    await mkdir(batchDir, { recursive: true })

    await writeFile(join(batchDir, 'fixed.md'), `# Fixed Findings — Batch 0

> Last updated: 2026-03-28

### [F-001] External fixed finding

**File**: \`web/lib/example.ts:10\`
**Severity**: medium
**Description**: Something broke.
**Suggested Fix**: Add the missing guard.
**Fixed in**: Added the missing guard.

---
`)

    const seen: ReviewMemoryRecord[] = []
    await runReviewMemoryBackfill({
      repo: 'external-repo',
      batchDir,
      nowIso: '2026-03-28T00:00:00.000Z',
      recordResolution: vi.fn(async ({ record }: { record: ReviewMemoryRecord }) => {
        seen.push(record)
        return { uid: record.uid, operation: 'created', storedAt: record.updatedAt }
      }),
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.sourceFile).toBe('review/batch-0/fixed.md')
  })

  it('prefers archived fixed and not-issue files when review/archive/batch-0 exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-memory-archive-backfill-'))
    tempDirs.push(root)
    const batchDir = join(root, 'review', 'batch-0')
    const archiveDir = join(root, 'review', 'archive', 'batch-0')
    await mkdir(batchDir, { recursive: true })
    await mkdir(archiveDir, { recursive: true })

    await writeFile(join(batchDir, 'fixed.md'), `# Fixed Findings — Batch 0

> Last updated: 2026-03-29

Closed fixed records are archived in review-memory and review/archive/batch-0/fixed.md.
`)
    await writeFile(join(batchDir, 'not-issue.md'), `# Not-Issue Findings — Batch 0

> Last updated: 2026-03-29

Closed not-issue records are archived in review-memory and review/archive/batch-0/not-issue.md.
`)
    await writeFile(join(batchDir, 'todo.md'), `# Todo Findings — Batch 0

> Last updated: 2026-03-28

### [T-001] Needs product decision

**File**: \`web/lib/product.ts:30\`
**Severity**: medium
**Description**: Needs a contract decision.
**Suggested Fix**: Ask product.
**Reason**: Public API decision required.

---
`)

    await writeFile(join(archiveDir, 'fixed.md'), `# Fixed Findings — Batch 0

> Last updated: 2026-03-28

### [F-001] Archived fixed finding

**File**: \`web/lib/example.ts:10\`
**Severity**: medium
**Description**: Something broke.
**Suggested Fix**: Add the missing guard.
**Fixed in**: Added the missing guard.

---
`)
    await writeFile(join(archiveDir, 'not-issue.md'), `# Not-Issue Findings — Batch 0

> Last updated: 2026-03-28

### [N-001] Archived not-issue finding

**File**: \`web/lib/other.ts:20\`
**Severity**: low
**Description**: Looked unsafe.
**Suggested Fix**: Add another guard.
**Reason**: False positive — already validated upstream.

---
`)

    const seen: ReviewMemoryRecord[] = []
    const result = await runReviewMemoryBackfill({
      repo: 'clawnews',
      batchDir,
      nowIso: '2026-03-28T00:00:00.000Z',
      recordResolution: vi.fn(async ({ record }: { record: ReviewMemoryRecord }) => {
        seen.push(record)
        return { uid: record.uid, operation: 'created', storedAt: record.updatedAt }
      }),
    })

    expect(result).toMatchObject({
      processed: 3,
      created: 3,
      updated: 0,
      files: [
        'review/archive/batch-0/fixed.md',
        'review/archive/batch-0/not-issue.md',
        'review/batch-0/todo.md',
      ],
    })
    expect(seen.map((record) => record.sourceFile)).toEqual([
      'review/archive/batch-0/fixed.md',
      'review/archive/batch-0/not-issue.md',
      'review/batch-0/todo.md',
    ])
  })
})
