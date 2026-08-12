import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, Pencil, X } from 'lucide-react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'

const FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'domain', label: 'Domain' },
  { key: 'primaryContactName', label: 'Primary Contact' },
  { key: 'primaryContactEmail', label: 'Contact Email' },
]

// El path guardado lleva un prefijo de timestamp para evitar colisiones en
// Storage (ver uploadClientMsa) — para mostrarlo se pela ese prefijo y
// cualquier carpeta demo/.
function msaFileName(msaUrl) {
  if (!msaUrl) return null
  return msaUrl.split('/').pop().replace(/^\d+-/, '')
}

/**
 * Drawer de detalle de Client (step 1 del flujo de dos pasos, igual que
 * Projects): campos en modo lectura + botón Edit.
 *
 * @param {{ client: object, onClose: () => void, onEdit: () => void }} props
 */
export function ClientDetailDrawer({ client, onClose, onEdit }) {
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function handleViewMsa() {
    setOpening(true)
    try {
      const url = await api.clients.getMsaUrl(client.msaUrl)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setOpening(false)
    }
  }

  return (
    <motion.div
      className="drawer-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-drawer-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Client</span>
            <h2 className="drawer__title" id="client-drawer-title">
              {client.clientName}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Client details</span>
          <dl className="drawer__facts">
            {FIELDS.map((field) => (
              <div className="drawer__fact" key={field.key}>
                <dt>{field.label}</dt>
                <dd>{client[field.key] || '—'}</dd>
              </div>
            ))}
            <div className="drawer__fact">
              <dt>MSA on file</dt>
              <dd>
                {client.msaUrl ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleViewMsa}
                    disabled={opening}
                  >
                    <FileText size={14} aria-hidden="true" /> {msaFileName(client.msaUrl)}
                  </button>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="drawer__fact">
              <dt>Created</dt>
              <dd>{formatDateTime(client.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="drawer__actions">
          <button type="button" className="btn btn--pay drawer__advance" onClick={onEdit}>
            <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
            Edit
          </button>
        </div>
      </motion.aside>
    </motion.div>
  )
}
