#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

type FindingKind = 'fixed' | 'not-issue'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function standardTitle(kind: 'review' | 'todo' | FindingKind) {
  switch (kind) {
    case 'review':
      return 'Review Findings'
    case 'todo':
      return 'Todo Findings'
    case 'fixed':
      return 'Fixed Findings'
    case 'not-issue':
      return 'Not-Issue Findings'
  }
}

function archiveFileName(kind: FindingKind) {
  return kind === 'fixed' ? 'fixed.md' : 'not-issue.md'
}

function activeStub(kind: FindingKind, batchId: string, date: string) {
  const archivePath = `review/archive/${batchId}/${archiveFileName(kind)}`
  const label = kind === 'fixed' ? 'fixed' : 'not-issue'
  return `# ${standardTitle(kind)} — ${formatBatchLabel(batchId)}

> Last updated: ${date}

Closed ${label} records are archived in \`${archivePath}\` and synced to review-memory MCP.
Do not add detailed entries here.
`
}

function emptyActiveFile(kind: 'review' | 'todo', batchId: string, date: string) {
  const emptyLine = kind === 'review' ? 'No open findings.' : 'No deferred findings.'
  return `# ${standardTitle(kind)} — ${formatBatchLabel(batchId)}

> Last updated: ${date}

${emptyLine}
`
}

function emptyArchiveFile(kind: FindingKind, batchId: string, date: string) {
  const emptyLine = kind === 'fixed' ? 'No archived fixed findings.' : 'No archived not-issue findings.'
  return `# ${standardTitle(kind)} — ${formatBatchLabel(batchId)}

> Last updated: ${date}

${emptyLine}
`
}

function formatBatchLabel(batchId: string) {
  return `Batch ${batchId.replace(/^batch-/, '')}`
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, '\n').trim()
}

async function ensureFile(path: string, content: string) {
  if (!existsSync(path)) {
    await writeFile(path, `${content.trimEnd()}\n`, 'utf8')
    return 'created'
  }
  return 'kept'
}

async function migrateRepo(repoPath: string) {
  const batchId = 'batch-0'
  const date = todayIsoDate()
  const batchDir = join(repoPath, 'review', batchId)
  const archiveDir = join(repoPath, 'review', 'archive', batchId)

  if (!existsSync(batchDir)) {
    throw new Error(`${repoPath}: missing review/${batchId}`)
  }

  await mkdir(archiveDir, { recursive: true })

  const report: string[] = []
  report.push(`repo=${basename(repoPath)}`)

  for (const kind of ['fixed', 'not-issue'] satisfies FindingKind[]) {
    const activePath = join(batchDir, archiveFileName(kind))
    const archivePath = join(archiveDir, archiveFileName(kind))

    if (existsSync(activePath) && !existsSync(archivePath)) {
      await rename(activePath, archivePath)
      report.push(`moved ${archiveFileName(kind)} -> review/archive/${batchId}/${archiveFileName(kind)}`)
    } else if (!existsSync(archivePath)) {
      await writeFile(archivePath, `${emptyArchiveFile(kind, batchId, date).trimEnd()}\n`, 'utf8')
      report.push(`created empty archive ${archiveFileName(kind)}`)
    }

    const stub = activeStub(kind, batchId, date)
    const current = existsSync(activePath) ? await readFile(activePath, 'utf8') : ''
    if (normalizeText(current) !== normalizeText(stub)) {
      await writeFile(activePath, `${stub.trimEnd()}\n`, 'utf8')
      report.push(`stubbed review/${batchId}/${archiveFileName(kind)}`)
    } else {
      report.push(`kept stub review/${batchId}/${archiveFileName(kind)}`)
    }
  }

  await ensureFile(join(batchDir, 'review.md'), emptyActiveFile('review', batchId, date))
  await ensureFile(join(batchDir, 'todo.md'), emptyActiveFile('todo', batchId, date))

  return report
}

async function main() {
  const repos = process.argv.slice(2)
  if (repos.length === 0) {
    throw new Error('Pass one or more repository roots')
  }

  for (const repo of repos) {
    const report = await migrateRepo(repo)
    for (const line of report) {
      console.log(line)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
