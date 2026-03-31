'use client'

import { useRef } from 'react'

interface UploadZoneProps {
  type: 'preview' | 'content'
  accept?: string
  file: File | null
  uploadResult: { blobId: string } | null
  uploading: boolean
  disabled: boolean
  onFileSelect: (file: File) => void
  onClear?: () => void
}

function ImagePlusIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: 0.4 }}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16l5-5 4 4 3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <path d="M15 7v4M13 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: 0.4 }}>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function LockSmallIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadZone({
  type,
  accept,
  file,
  uploadResult,
  uploading,
  disabled,
  onFileSelect,
  onClear,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const isUploaded = uploadResult != null

  const borderColor = isUploaded
    ? 'var(--accent-emerald)'
    : 'var(--border-default)'

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) {
        inputRef.current?.click()
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) {
      onFileSelect(selected)
    }
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (disabled) return
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) {
      onFileSelect(dropped)
    }
  }

  return (
    <div className="relative flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={type === 'preview' ? 'Upload preview image' : 'Upload content file'}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="relative overflow-hidden flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer select-none"
        style={{
          minHeight: '200px',
          border: `2px dashed ${borderColor}`,
          background: 'var(--bg-surface)',
          transition: 'border-color 0.2s ease',
          cursor: disabled ? 'default' : 'pointer',
          padding: '24px 16px',
        }}
      >
        {/* Indeterminate progress bar */}
        {uploading && (
          <div
            className="absolute top-0 left-0 right-0"
            style={{ height: '2px', background: 'var(--border-subtle)', overflow: 'hidden' }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--accent-cyan)',
                width: '40%',
                animation: 'upload-slide 1.2s ease-in-out infinite',
              }}
            />
          </div>
        )}

        {/* Preview image uploaded */}
        {type === 'preview' && isUploaded && !uploading ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${uploadResult.blobId}`}
              alt="Preview"
              className="max-w-full rounded-lg"
              style={{ maxHeight: '160px', objectFit: 'contain' }}
            />
          </div>
        ) : type === 'content' && isUploaded && !uploading ? (
          /* Content uploaded state */
          <div className="flex flex-col items-center gap-2 text-center">
            <LockSmallIcon />
            <span className="text-sm font-medium" style={{ color: 'var(--accent-emerald)' }}>
              {file?.name ?? 'Content staged'}
            </span>
            <span
              className="badge badge-emerald text-xs"
              style={{ background: 'var(--accent-emerald-dim)', color: 'var(--accent-emerald)' }}
            >
              Ready
            </span>
          </div>
        ) : file && !isUploaded && !uploading ? (
          /* File selected, not yet uploaded */
          <div className="flex flex-col items-center gap-2 text-center">
            {type === 'preview' ? <ImagePlusIcon /> : <LockIcon />}
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {file.name}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatFileSize(file.size)}
            </span>
          </div>
        ) : uploading ? (
          /* Uploading state */
          <div className="flex flex-col items-center gap-2 text-center">
            {type === 'preview' ? <ImagePlusIcon /> : <LockIcon />}
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Uploading…
            </span>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center gap-2 text-center">
            {type === 'preview' ? <ImagePlusIcon /> : <LockIcon />}
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Click or drag to upload
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {type === 'preview'
                ? 'JPEG, PNG, WebP, GIF'
                : 'Any file type — encrypted at publish time'}
            </span>
          </div>
        )}
      </div>

      {/* Clear / remove button — shown when uploaded for preview type */}
      {isUploaded && onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          className="absolute top-2 right-2 flex items-center justify-center rounded-full"
          style={{
            width: '22px',
            height: '22px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          aria-label="Remove file"
        >
          <XIcon />
        </button>
      )}

      <style>{`
        @keyframes upload-slide {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  )
}
