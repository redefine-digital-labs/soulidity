/**
 * Client-side file parser for Import Soul.
 *
 * Reads .json / .md / .txt files, extracts fields, and computes stats.
 * ZIP is not supported in v1 (would require jszip dependency).
 */

import { autoMapFields, type FieldMapping } from './field-mapping'

export interface ParsedField {
  key: string
  value: unknown
  displayValue: string
  type: 'string' | 'array' | 'object' | 'number' | 'boolean'
  entryCount: number // for arrays, number of entries; 1 otherwise
}

export interface ParseStats {
  fieldCount: number
  entryCount: number // total entries across all fields
  sizeBytes: number
  parsingScore: number // 0-100
}

export interface ParseResult {
  fields: ParsedField[]
  stats: ParseStats
  suggestedMappings: FieldMapping[]
  rawText: string // original text for originRef hashing
}

const MAX_DISPLAY_LENGTH = 120
const MAX_DEPTH = 2

function truncate(value: string, max = MAX_DISPLAY_LENGTH): string {
  if (value.length <= max) return value
  return value.slice(0, max) + '\u2026'
}

function fieldType(value: unknown): ParsedField['type'] {
  if (Array.isArray(value)) return 'array'
  if (value === null || value === undefined) return 'string'
  const t = typeof value
  if (t === 'object') return 'object'
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    // Show first few items
    const items = value.slice(0, 3).map((v) =>
      typeof v === 'string' ? v : JSON.stringify(v),
    )
    const suffix = value.length > 3 ? ` (+${value.length - 3} more)` : ''
    return truncate(items.join(', ') + suffix)
  }
  return truncate(JSON.stringify(value))
}

function entryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  return 1
}

/**
 * Walk a JSON object up to MAX_DEPTH, extracting fields.
 * Uses dot-notation for nested keys (e.g., "character.name").
 */
function extractJsonFields(obj: Record<string, unknown>, prefix = '', depth = 0): ParsedField[] {
  const fields: ParsedField[] = []

  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (val !== null && typeof val === 'object' && !Array.isArray(val) && depth < MAX_DEPTH) {
      // Recurse into nested objects
      fields.push(...extractJsonFields(val as Record<string, unknown>, fullKey, depth + 1))
    } else {
      fields.push({
        key: fullKey,
        value: val,
        displayValue: displayValue(val),
        type: fieldType(val),
        entryCount: entryCount(val),
      })
    }
  }

  return fields
}

/**
 * Parse a JSON file.
 */
function parseJson(text: string): ParsedField[] {
  const parsed = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object at the top level')
  }
  return extractJsonFields(parsed as Record<string, unknown>)
}

/**
 * Parse a Markdown file by splitting on ## headings.
 */
function parseMarkdown(text: string): ParsedField[] {
  const fields: ParsedField[] = []

  // Try ## headings first, then # headings
  const h2Regex = /^##\s+(.+)$/gm
  const matches = [...text.matchAll(h2Regex)]

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i][1].trim()
      const start = matches[i].index! + matches[i][0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
      const content = text.slice(start, end).trim()

      fields.push({
        key: heading.toLowerCase().replace(/\s+/g, '_'),
        value: content,
        displayValue: displayValue(content),
        type: 'string',
        entryCount: 1,
      })
    }
    return fields
  }

  // Fall back to # headings
  const h1Regex = /^#\s+(.+)$/gm
  const h1Matches = [...text.matchAll(h1Regex)]

  if (h1Matches.length > 0) {
    for (let i = 0; i < h1Matches.length; i++) {
      const heading = h1Matches[i][1].trim()
      const start = h1Matches[i].index! + h1Matches[i][0].length
      const end = i + 1 < h1Matches.length ? h1Matches[i + 1].index! : text.length
      const content = text.slice(start, end).trim()

      fields.push({
        key: heading.toLowerCase().replace(/\s+/g, '_'),
        value: content,
        displayValue: displayValue(content),
        type: 'string',
        entryCount: 1,
      })
    }
    return fields
  }

  // No headings — treat entire file as a single "content" field
  fields.push({
    key: 'content',
    value: text,
    displayValue: displayValue(text),
    type: 'string',
    entryCount: 1,
  })

  return fields
}

/**
 * Detect file format from extension and content.
 */
function detectFormat(file: File): 'json' | 'markdown' | 'unsupported' {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.markdown')) return 'markdown'
  if (name.endsWith('.character')) return 'json' // Character.AI export format
  if (name.endsWith('.zip')) return 'unsupported'

  // Fallback: try to detect from content type
  if (file.type === 'application/json') return 'json'
  if (file.type?.startsWith('text/')) return 'markdown'

  return 'unsupported'
}

/**
 * Compute SHA-256 hex string of file content for originRef.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Parse an import file, extract fields, compute stats, and suggest mappings.
 */
export async function parseImportFile(file: File): Promise<ParseResult> {
  const format = detectFormat(file)

  if (format === 'unsupported') {
    throw new Error(
      file.name.endsWith('.zip')
        ? 'ZIP support coming soon. Please extract and upload a .json or .md file.'
        : `Unsupported file format: ${file.name}. Please upload a .json, .md, or .txt file.`,
    )
  }

  const rawText = await file.text()

  if (!rawText.trim()) {
    throw new Error('File is empty. Please upload a file with content.')
  }

  let fields: ParsedField[]

  if (format === 'json') {
    try {
      fields = parseJson(rawText)
    } catch (err) {
      throw new Error(
        `Failed to parse JSON: ${err instanceof Error ? err.message : 'Unknown error'}. Please check the file format.`,
      )
    }
  } else {
    fields = parseMarkdown(rawText)
  }

  if (fields.length === 0) {
    throw new Error('No parseable fields found in the file.')
  }

  const { mappings: suggestedMappings, parsingScore } = autoMapFields(
    fields.map((f) => f.key),
  )

  const totalEntries = fields.reduce((sum, f) => sum + f.entryCount, 0)

  return {
    fields,
    stats: {
      fieldCount: fields.length,
      entryCount: totalEntries,
      sizeBytes: file.size,
      parsingScore,
    },
    suggestedMappings,
    rawText,
  }
}
