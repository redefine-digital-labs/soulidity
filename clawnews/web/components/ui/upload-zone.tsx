'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface UploadZoneProps {
  icon?: string
  label?: string
  sublabel?: string
  accept?: string
  multiple?: boolean
  /** Enable folder (directory) selection instead of single file */
  directory?: boolean
  onFileSelect?: (file: File) => void
  /** Callback for directory mode — receives all files in the selected folder */
  onFilesSelect?: (files: FileList) => void
  className?: string
}

function UploadZone({
  icon = '📁',
  label = 'Click to upload or drag and drop',
  sublabel,
  accept,
  multiple,
  directory,
  onFileSelect,
  onFilesSelect,
  className,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClick() {
    inputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    if ((directory || multiple) && onFilesSelect) {
      onFilesSelect(files)
    } else if (onFileSelect && files[0]) {
      onFileSelect(files[0])
    }
    // Reset input so same selection can be re-selected
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    if ((directory || multiple) && onFilesSelect) {
      onFilesSelect(files)
    } else if (onFileSelect && files[0]) {
      onFileSelect(files[0])
    }
  }

  // Build extra attributes for directory mode
  const inputProps: Record<string, string> = {}
  if (directory) {
    inputProps.webkitdirectory = ''
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer',
        'hover:border-purple hover:bg-purple/5 transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-purple/50',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={directory ? undefined : accept}
        multiple={Boolean(multiple)}
        onChange={handleChange}
        className="sr-only"
        tabIndex={-1}
        {...inputProps}
      />

      {icon && (
        <div className="text-3xl mb-3 leading-none" aria-hidden="true">
          {icon}
        </div>
      )}

      {label && (
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
      )}

      {sublabel && (
        <p className="mt-1 text-xs text-muted">{sublabel}</p>
      )}
    </div>
  )
}

export { UploadZone }
export type { UploadZoneProps }
