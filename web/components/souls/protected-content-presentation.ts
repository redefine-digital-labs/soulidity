type Attachment = { kind: 'image' | 'download'; url: string }
export type ProtectedContentPresentation = { text: string | null; attachment: Attachment | null }

export function presentVerifiedContent(
  content: { bytes: Uint8Array; mimeType: string; downloadAllowed: boolean },
  inlineImages = false,
): ProtectedContentPresentation {
  const { bytes, mimeType, downloadAllowed } = content
  if (/^(text\/(plain|markdown)|application\/json)(;|$)/.test(mimeType) && bytes.length <= 1024 * 1024) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), attachment: null } }
    catch { /* Keep non-UTF-8 files on the verified file path. */ }
  }

  const image = inlineImages && /^image\/(png|jpeg|gif|webp)$/.test(mimeType) && bytes.length <= 20 * 1024 * 1024
  if (!image && downloadAllowed !== true) {
    return { text: 'The current record restricts file downloads.', attachment: null }
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
    type: image ? mimeType : 'application/octet-stream',
  }))
  return { text: null, attachment: { kind: image ? 'image' : 'download', url } }
}
