import type { BatchSoulEntry } from '@/components/providers/create-collection-provider'

export const BATCH_TEMPLATE_HEADERS = [
  'Soul Name',
  'Description',
  'Tags',
  'Creator Royalty (%)',
] as const

export const BATCH_TEMPLATE_EXAMPLE_ROW = [
  'AlphaScout',
  'A DeFi alpha-hunting agent specializing in emerging DEX pools on Sui',
  'ai, trading, defi',
  5,
] as const

function str(raw: unknown): string {
  return String(raw ?? '').trim()
}

export function normalizeBatchTemplateRows(
  rows: Record<string, unknown>[],
  defaultRoyaltyBps: number,
  supplyCap?: number,
): { souls: BatchSoulEntry[]; errors: string[] } {
  if (rows.length === 0) {
    return { souls: [], errors: ['No data rows found in the template.'] }
  }

  const souls: BatchSoulEntry[] = []
  const errors: string[] = []

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNumber = index + 2

    const name = str(row['Soul Name'])
    if (!name) {
      errors.push(`Row ${rowNumber}: Soul Name is required`)
      continue
    }

    const description = str(row.Description)
    if (!description) {
      errors.push(`Row ${rowNumber}: Description is required`)
      continue
    }

    const tagsRaw = str(row.Tags)
    const tags = tagsRaw ? tagsRaw.split(',').map((value) => value.trim()).filter(Boolean) : []

    const royaltyRaw = row['Creator Royalty (%)']
    let creatorRoyaltyBps = defaultRoyaltyBps
    if (royaltyRaw !== undefined && royaltyRaw !== '') {
      const pct = Number(royaltyRaw)
      if (Number.isNaN(pct) || pct < 0 || pct > 25) {
        errors.push(`Row ${rowNumber}: Creator Royalty must be 0–25 (%)`)
        continue
      }
      creatorRoyaltyBps = Math.round(pct * 100)
    }

    souls.push({
      name,
      description,
      tags,
      creatorRoyaltyBps,
    })
  }

  if (supplyCap !== undefined && souls.length > supplyCap) {
    errors.push(`Template has ${souls.length} Souls but Supply Cap is ${supplyCap} — remove ${souls.length - supplyCap} row(s)`)
  }

  return { souls, errors }
}
