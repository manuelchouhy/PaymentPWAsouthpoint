import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'

export function ExportDropdown({ onExport }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function close(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="export-wrap">
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Download size={14} aria-hidden="true" />
        Export
      </button>
      {open && (
        <div className="export-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="export-menu__item"
            onClick={() => { onExport('xlsx'); setOpen(false) }}
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            className="export-menu__item"
            onClick={() => { onExport('pdf'); setOpen(false) }}
          >
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  )
}
