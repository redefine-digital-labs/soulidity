import type { BatchSoulEntry, SoulFolderFiles, SoulFolderMap } from '@/components/providers/create-collection-provider'

// Column headers — metadata only (files come from numbered subfolders)
const HEADERS = [
  'Soul Name',
  'Description',
  'Category',
  'Tags',
  'Creator Royalty (%)',
] as const

const VALID_CATEGORIES = ['Trading', 'Research', 'Assistant', 'Creator'] as const

const EXAMPLE_ROW = [
  'AlphaScout',
  'A DeFi alpha-hunting agent specializing in emerging DEX pools on Sui',
  'Trading',
  'ai, trading, defi',
  5,
]

export async function downloadTemplate(format: 'xlsx' | 'csv') {
  const XLSX = await import('xlsx')

  const ws = XLSX.utils.aoa_to_sheet([[...HEADERS], EXAMPLE_ROW])

  ws['!cols'] = [
    { wch: 20 },  // Soul Name
    { wch: 48 },  // Description
    { wch: 14 },  // Category
    { wch: 24 },  // Tags
    { wch: 18 },  // Creator Royalty
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Souls')

  const filename = format === 'xlsx'
    ? 'soul-collection-template.xlsx'
    : 'soul-collection-template.csv'

  XLSX.writeFile(wb, filename, format === 'csv' ? { bookType: 'csv' } : undefined)
}

function str(raw: unknown): string {
  return String(raw ?? '').trim()
}

export async function parseTemplateFile(
  file: File,
  defaultRoyaltyBps: number,
  supplyCap?: number,
): Promise<{ souls: BatchSoulEntry[]; errors: string[] }> {
  const XLSX = await import('xlsx')
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data)
  const ws = wb.Sheets[wb.SheetNames[0]]

  if (!ws) return { souls: [], errors: ['No worksheet found in file.'] }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

  if (rows.length === 0) return { souls: [], errors: ['No data rows found in the template.'] }

  const souls: BatchSoulEntry[] = []
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const r = i + 2 // 1-indexed, header is row 1

    // ── Required text fields ──
    const name = str(row['Soul Name'])
    if (!name) { errors.push(`Row ${r}: Soul Name is required`); continue }

    const description = str(row['Description'])
    if (!description) { errors.push(`Row ${r}: Description is required`); continue }

    // ── Category ──
    const categoryRaw = str(row['Category'])
    if (!categoryRaw) { errors.push(`Row ${r}: Category is required`); continue }
    const category = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === categoryRaw.toLowerCase(),
    )
    if (!category) {
      errors.push(`Row ${r}: Category must be one of: ${VALID_CATEGORIES.join(', ')}`)
      continue
    }

    // ── Tags (optional, comma-separated) ──
    const tagsRaw = str(row['Tags'])
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []

    // ── Creator Royalty (optional, defaults to collection setting) ──
    const royaltyRaw = row['Creator Royalty (%)']
    let creatorRoyaltyBps = defaultRoyaltyBps
    if (royaltyRaw !== undefined && royaltyRaw !== '') {
      const pct = Number(royaltyRaw)
      if (isNaN(pct) || pct < 0 || pct > 25) {
        errors.push(`Row ${r}: Creator Royalty must be 0–25 (%)`)
        continue
      }
      creatorRoyaltyBps = Math.round(pct * 100) // % → bps
    }

    souls.push({
      name,
      description,
      category,
      tags,
      creatorRoyaltyBps,
    })
  }

  // ── Supply cap check ──
  if (supplyCap !== undefined && souls.length > supplyCap) {
    errors.push(`Template has ${souls.length} Souls but Supply Cap is ${supplyCap} — remove ${souls.length - supplyCap} row(s)`)
  } else if (supplyCap !== undefined && souls.length < supplyCap) {
    errors.push(`Template has ${souls.length} Soul(s) but Supply Cap is ${supplyCap} — add ${supplyCap - souls.length} more row(s) or adjust the Supply Cap in Step 1`)
  }

  return { souls, errors }
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

function extOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
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
