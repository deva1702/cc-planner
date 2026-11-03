
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'

export default function ImportExcel({
  loading,
  importMetadata,
  onImportActivities,
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Close the popover when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return

    const handleOutsideClick = event => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    const handleEscapeKey = event => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscapeKey)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [open])

  return (
    <div className="import-control" ref={containerRef}>
      <button
        type="button"
        className="outline-button import-button"
        onClick={() => setOpen(value => !value)}
        disabled={loading}
        aria-expanded={open}
      >
        <FileSpreadsheet size={16} />
        Import Excel
      </button>

      {open && (
        <div className="import-popover">
          <div className="import-popover-title">
            <FileSpreadsheet size={17} />
            <strong>Import activities</strong>
          </div>

          <p>
            Select an Excel (.xlsx) or CSV file containing your activity schedule.
          </p>

          {importMetadata && (
            <div className="import-file-info">
              <strong>{importMetadata.source_filename}</strong>
              <span>{importMetadata.activity_count} activities imported</span>
            </div>
          )}

          <button
            type="button"
            className="primary-button compact import-select-button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            <FileSpreadsheet size={14} />
            Choose file
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={event => {
              const file = event.target.files?.[0]
              // Reset the input so the same file can be selected again.
              event.target.value = ''
              setOpen(false)

              if (file) onImportActivities?.(file)
            }}
          />
        </div>
      )}
    </div>
  )
}
