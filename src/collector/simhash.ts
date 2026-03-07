export {
  findDuplicateMatch,
  jaccardSimilarity,
  normalizeUrl,
  SIMILARITY_THRESHOLD,
  titleHash,
  tokenize,
} from '../shared/dedup.js'

export type {
  DedupCandidate,
  DedupReference,
  DuplicateMatch,
} from '../shared/dedup.js'
