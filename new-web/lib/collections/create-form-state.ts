import {
  MAX_COLLECTION_ROYALTY_BPS,
  MAX_DESCRIPTION_BYTES,
  MAX_IMAGE_URL_BYTES,
  MAX_NAME_BYTES,
  getUtf8ByteLength,
} from '@/lib/soulidity/tx/shared'

export interface CreateCollectionFormValues {
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  tradeable: boolean
}

export interface CreateCollectionFormState {
  byteCounts: {
    name: number
    description: number
    imageUrl: number
  }
  fieldErrors: {
    name: string | null
    description: string | null
    imageUrl: string | null
    extraRoyaltyBps: string | null
  }
  isComplete: boolean
}

export interface CreateCollectionSyncResult {
  txDigest: string
  collectionOnChainId: string
  rightOnChainId: string
  listingStatus: 'held' | 'listed'
}

function getRequiredAndByteLimitError(value: string, maxBytes: number) {
  if (value.trim().length === 0) {
    return 'Required'
  }
  if (getUtf8ByteLength(value) > maxBytes) {
    return `Must be ${maxBytes} UTF-8 bytes or fewer`
  }
  return null
}

function getRoyaltyError(extraRoyaltyBps: number) {
  if (!Number.isInteger(extraRoyaltyBps) || extraRoyaltyBps < 0 || extraRoyaltyBps > MAX_COLLECTION_ROYALTY_BPS) {
    return `Must be an integer from 0 to ${MAX_COLLECTION_ROYALTY_BPS}`
  }
  return null
}

export function getCreateCollectionFormState(values: CreateCollectionFormValues): CreateCollectionFormState {
  const byteCounts = {
    name: getUtf8ByteLength(values.name),
    description: getUtf8ByteLength(values.description),
    imageUrl: getUtf8ByteLength(values.imageUrl),
  }

  const fieldErrors = {
    name: getRequiredAndByteLimitError(values.name, MAX_NAME_BYTES),
    description: getRequiredAndByteLimitError(values.description, MAX_DESCRIPTION_BYTES),
    imageUrl: getRequiredAndByteLimitError(values.imageUrl, MAX_IMAGE_URL_BYTES),
    extraRoyaltyBps: getRoyaltyError(values.extraRoyaltyBps),
  }

  return {
    byteCounts,
    fieldErrors,
    isComplete: Object.values(fieldErrors).every((value) => value == null),
  }
}

export function getCreateCollectionRedirectHref(result: Pick<CreateCollectionSyncResult, 'collectionOnChainId'>) {
  return `/collections/${encodeURIComponent(result.collectionOnChainId)}`
}
