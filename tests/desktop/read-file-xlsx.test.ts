import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const desktopRequire = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../desktop/packages/backend/package.json'))
const writeXlsxFile = desktopRequire('write-excel-file/node')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readFileScriptPath = resolve(
  repoRoot,
  'desktop/packages/backend/src/agent/skills/file/scripts/read_file.ts',
)

async function createWorkbook(filePath: string) {
  await writeXlsxFile([
    {
      sheet: 'Sheet1',
      data: [
        ['text', 'multiline', 'path', 'count'],
        ['hello\tworld', 'line1\nline2', 'C:\\Users\\Alice', 2],
      ],
    },
  ]).toFile(filePath)
}

function runReadFile(filePath: string, allowedRoot: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', 'tsx', readFileScriptPath, JSON.stringify({ path: filePath })],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        // The default allowlist in path-security.ts is ~/Desktop, ~/Documents,
        // ~/Downloads, plus DATA_DIR. Dev machines often happen to satisfy
        // that (the repo is checked out under ~/Desktop), but CI runners
        // never do. Pin the test's tmp dir as an explicit allowed root so
        // the script can see the workbook regardless of cwd.
        env: { ...process.env, ADDITIONAL_ALLOWED_ROOTS: allowedRoot },
      },
    ),
  ) as { success: boolean; content?: string; error?: string }
}

describe('read_file xlsx extraction', () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('escapes tab and newline cell content without losing cell boundaries', async () => {
    tempDir = mkdtempSync(join(repoRoot, 'tmp-read-file-'))
    const workbookPath = join(tempDir, 'escaped-cells.xlsx')
    await createWorkbook(workbookPath)

    const result = runReadFile(workbookPath, tempDir)

    expect(result).toEqual({
      success: true,
      content: '=== Sheet: Sheet1 ===\ntext\tmultiline\tpath\tcount\nhello\\tworld\tline1\\nline2\tC:\\Users\\Alice\t2',
    })
  })
})
