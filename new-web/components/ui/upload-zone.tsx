'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface UploadZoneProps {
  icon?: string
  label?: string
  sublabel?: string
  accept?: string
  onFileSelect?: (file: File) => void
  className?: string
}

function UploadZone({
  icon = '📁',
  label = 'Click to upload or drag and drop',
  sublabel,
  accept,
  onFileSelect,
  className,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClick() {
    inputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onFileSelect) {
      onFileSelect(file)
    }
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && onFileSelect) {
      onFileSelect(file)
    }
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
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        tabIndex={-1}
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
