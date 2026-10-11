import type { BatchSoulEntry, SoulFolderFiles, SoulFolderMap } from '@/components/providers/create-collection-provider'
import {
  BATCH_TEMPLATE_EXAMPLE_ROW,
  BATCH_TEMPLATE_HEADERS,
  normalizeBatchTemplateRows,
} from '@/lib/collections/batch-template'

const TEMPLATE_COLUMNS = [
  { width: 20 },
  { width: 48 },
  { width: 14 },
  { width: 24 },
  { width: 18 },
]

function extOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

function escapeCsvCell(value: string | number) {
  const stringValue = String(value)
  if (!/[",\r\n]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

function buildCsvTemplate() {
  return [
    BATCH_TEMPLATE_HEADERS.map(escapeCsvCell).join(','),
    BATCH_TEMPLATE_EXAMPLE_ROW.map(escapeCsvCell).join(','),
  ].join('\r\n')
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char === '\r') {
      continue
    } else {
      cell += char
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function rowsToTemplateObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (rows.length === 0) {
    return []
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((value) => String(value ?? '').trim())

  return dataRows
    .filter((row) => row.some((value) => String(value ?? '').trim().length > 0))
    .map((row) => {
      const record: Record<string, unknown> = {}
      headers.forEach((header, index) => {
        if (!header) return
        record[header] = row[index]
      })
      return record
    })
}

export async function downloadTemplate(format: 'xlsx' | 'csv') {
  if (format === 'csv') {
    const csv = buildCsvTemplate()
    triggerBrowserDownload(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), 'soul-collection-template.csv')
    return
  }

  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const result = await writeExcelFile([
    [...BATCH_TEMPLATE_HEADERS],
    [...BATCH_TEMPLATE_EXAMPLE_ROW],
  ], {
    columns: TEMPLATE_COLUMNS,
    sheet: 'Souls',
  })
  const blob = await result.toBlob()
  triggerBrowserDownload(blob, 'soul-collection-template.xlsx')
}

export async function parseTemplateFile(
  file: File,
  defaultRoyaltyBps: number,
  supplyCap?: number,
): Promise<{ souls: BatchSoulEntry[]; errors: string[] }> {
  const extension = extOf(file.name)
  if (extension === '.xls') {
    return {
      souls: [],
      errors: ['Legacy .xls files are not supported. Please re-save the template as .xlsx or .csv and upload again.'],
    }
  }

  const rows = extension === '.csv'
    ? rowsToTemplateObjects(parseCsvRows(await file.text()))
    : rowsToTemplateObjects(await (await import('read-excel-file/browser')).readSheet(file))

  return normalizeBatchTemplateRows(rows, defaultRoyaltyBps, supplyCap)
}

// ── Folder processing ──

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.json': 'application/json',
}

/** Re-wrap a File with the correct MIME type based on extension (browsers often misdetect .md) */
function withMime(file: File): File {
  const expected = MIME_MAP[extOf(file.name)]
  if (!expected || file.type === expected) return file
  return new File([file], file.name, { type: expected })
}

function isTemplateFile(name: string) {
  const ext = extOf(name)
  return ext === '.xlsx' || ext === '.csv' || ext === '.xls'
}

/**
 * Process a folder upload: find the template, parse it, and extract per-soul files.
 *
 * Expected folder structure:
 *   root/
 *     template.xlsx
 *     1/ soul.md, memory.md, [image.*], [skills.zip]
 *     2/ soul.md, memory.md, ...
 */
export async function processFolderUpload(
  files: FileList,
  defaultRoyaltyBps: number,
  supplyCap?: number,
): Promise<{
  templateFile: File | null
  souls: BatchSoulEntry[]
  soulFolders: SoulFolderMap
  errors: string[]
  folderErrors: string[]
}> {
  let templateFile: File | null = null
  const folderMap = new Map<number, Partial<SoulFolderFiles>>()
  const folderErrors: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const parts = relPath.split('/')

    if (parts.length === 2) {
      // Root-level file — check for template
      if (isTemplateFile(parts[1]) && !templateFile) {
        templateFile = file
      }
    } else if (parts.length === 3) {
      // Subfolder file — parts[1] is folder number, parts[2] is filename
      const folderNum = parseInt(parts[1], 10)
      if (isNaN(folderNum) || folderNum < 1) continue

      const fileName = parts[2].toLowerCase()
      const entry = folderMap.get(folderNum) ?? {}

      if (fileName === 'soul.md') {
        entry.characterFile = withMime(file)
      } else if (fileName === 'memory.md') {
        entry.memoryFile = withMime(file)
      } else if (fileName === 'skills.zip') {
        entry.skillsFile = withMime(file)
      } else if (
        fileName === 'persona-sprite-config.json'
        || fileName === 'sprite-config.json'
        || fileName.startsWith('persona-sprite.')
      ) {
        // Persona sprites are now appended post-mint from each Soul detail page.
      } else if (!entry.imageFile && IMAGE_EXTS.has(extOf(fileName))) {
        entry.imageFile = withMime(file)
      }

      folderMap.set(folderNum, entry)
    }
  }

  if (!templateFile) {
    return {
      templateFile: null,
      souls: [],
      soulFolders: new Map(),
      errors: ['No template file (.xlsx / .csv) found in the root of the folder.'],
      folderErrors: [],
    }
  }

  // Parse template
  const { souls, errors } = await parseTemplateFile(templateFile, defaultRoyaltyBps, supplyCap)

  // Validate folder structure against template rows
  const soulFolders: SoulFolderMap = new Map()

  for (let i = 0; i < souls.length; i++) {
    const num = i + 1
    const entry = folderMap.get(num)

    if (!entry) {
      folderErrors.push(`Subfolder ${num}/ not found (for Soul "${souls[i].name}")`)
      continue
    }
    if (!entry.characterFile) {
      folderErrors.push(`Subfolder ${num}/: missing soul.md (for Soul "${souls[i].name}")`)
      continue
    }
    if (!entry.memoryFile) {
      folderErrors.push(`Subfolder ${num}/: missing memory.md (for Soul "${souls[i].name}")`)
      continue
    }

    soulFolders.set(num, {
      characterFile: entry.characterFile,
      memoryFile: entry.memoryFile,
      imageFile: entry.imageFile,
      skillsFile: entry.skillsFile,
    })
  }

  // Warn about extra subfolders
  for (const num of folderMap.keys()) {
    if (num > souls.length) {
      folderErrors.push(`Subfolder ${num}/ has no matching row in the template (only ${souls.length} rows)`)
    }
  }

  return { templateFile, souls, soulFolders, errors, folderErrors }
}
