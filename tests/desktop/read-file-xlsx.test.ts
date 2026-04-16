import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { zipSync, strToU8 } = require('../../web/node_modules/fflate')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readFileScriptPath = resolve(
  repoRoot,
  'desktop/packages/backend/src/agent/skills/file/scripts/read_file.ts',
)

function createEscapedWorkbook(filePath: string) {
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t xml:space="preserve">hello&#9;world</t></is></c>
      <c r="B1" t="inlineStr"><is><t xml:space="preserve">line1&#10;line2</t></is></c>
    </row>
    <row r="2">
      <c r="A2"><f>SUM(C1:C1)</f><v>2</v></c>
    </row>
  </sheetData>
</worksheet>`),
  }

  writeFileSync(filePath, Buffer.from(zipSync(files)))
}

function runReadFile(filePath: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', 'tsx', readFileScriptPath, JSON.stringify({ path: filePath })],
      {
        cwd: repoRoot,
        encoding: 'utf8',
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

  it('escapes tab and newline cell content without losing cached formula values', () => {
    tempDir = mkdtempSync(join(repoRoot, 'tmp-read-file-'))
    const workbookPath = join(tempDir, 'escaped-cells.xlsx')
    createEscapedWorkbook(workbookPath)

    const result = runReadFile(workbookPath)

    expect(result).toEqual({
      success: true,
      content: '=== Sheet: Sheet1 ===\nhello\\tworld\tline1\\nline2\n2',
    })
  })
})
