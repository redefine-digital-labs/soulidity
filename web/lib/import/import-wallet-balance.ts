interface ImportUploadObjectRef {
  blobObjectId?: string | null
}

export interface ImportUploadResultsForBalance {
  coverImage?: ImportUploadObjectRef | null
  charFile?: ImportUploadObjectRef | null
  memorySeed?: ImportUploadObjectRef | null
  skillsFile?: ImportUploadObjectRef | null
  spriteSheet?: ImportUploadObjectRef | null
}

export function txBoundImportUploadObjectIds(
  uploadResults: ImportUploadResultsForBalance | null | undefined,
): string[] {
  const ids = [
    uploadResults?.charFile?.blobObjectId,
    uploadResults?.memorySeed?.blobObjectId,
    uploadResults?.skillsFile?.blobObjectId,
    uploadResults?.spriteSheet?.blobObjectId,
  ].filter((value): value is string => Boolean(value))

  return Array.from(new Set(ids))
}

function hasVerifiedTxBoundUpload(
  upload: ImportUploadObjectRef | null | undefined,
  verifiedReusableBlobObjectIds: ReadonlySet<string> | null,
) {
  return Boolean(upload?.blobObjectId && verifiedReusableBlobObjectIds?.has(upload.blobObjectId))
}

export function countPendingImportUploads(params: {
  reusableUploadResults: ImportUploadResultsForBalance | null | undefined
  hasSkillsFile: boolean
  hasSpriteSheetFile: boolean
  verifiedReusableBlobObjectIds: ReadonlySet<string> | null
}): number {
  const { reusableUploadResults, verifiedReusableBlobObjectIds } = params

  return (
    (reusableUploadResults?.coverImage ? 0 : 1)
    + (hasVerifiedTxBoundUpload(reusableUploadResults?.charFile, verifiedReusableBlobObjectIds) ? 0 : 1)
    + (hasVerifiedTxBoundUpload(reusableUploadResults?.memorySeed, verifiedReusableBlobObjectIds) ? 0 : 1)
    + (params.hasSkillsFile && !hasVerifiedTxBoundUpload(reusableUploadResults?.skillsFile, verifiedReusableBlobObjectIds) ? 1 : 0)
    + (params.hasSpriteSheetFile && !hasVerifiedTxBoundUpload(reusableUploadResults?.spriteSheet, verifiedReusableBlobObjectIds) ? 1 : 0)
  )
}
