import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, Pencil, X } from 'lucide-react'
import { api } from '../lib/api'
import { fileNameFromPath, formatDateTime } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

const FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'domain', label: 'Domain' },
  { key: 'primaryContactName', label: 'Primary Contact' },
  { key: 'primaryContactEmail', label: 'Contact Email' },
  { key: 'zohoGroupName', label: 'Zoho Group (alias)' },
]

/**
 * Drawer de detalle de Client (step 1 del flujo de dos pasos, igual que
 * Projects): campos en modo lectura + botón Edit (si `canEdit`).
 *
 * @param {{ client: object, canEdit?: boolean, onClose: () => void, onEdit: () => void }} props
 */
export function ClientDetailDrawer({ client, canEdit = false, onClose, onEdit }) {
  const [opening, setOpening] = useState(false)
  const [msaMsg, setMsaMsg] = useState('')
  const isDemoMsa = typeof client.msaUrl === 'string' && client.msaUrl.startsWith('demo/')

  useScrollLock()

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function handleViewMsa() {
    setMsaMsg('')
    if (isDemoMsa) {
      setMsaMsg('Demo mode: the MSA cannot be downloaded (only the filename was saved).')
      return
    }
    setOpening(true)
    try {
      const url = await api.clients.getMsaUrl(client.msaUrl)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else setMsaMsg('Could not generate the download link.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Modal centrado, NO panel lateral: así lo define el mock
          (#client-drawer es un .modal-backdrop con un .modal-box de 440px) y es
          el mismo paso 1 de dos pasos que usa Projects. Antes entraba deslizando
          desde la derecha con x: '100%', que además dejaba el panel invisible si
          la animación no llegaba a correr. */}
      <motion.div
        className="modal modal--client-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-drawer-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Client</span>
            <h2 className="modal__title" id="client-drawer-title">
              {client.clientName}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {client.needsReview && (
          <div role="status" className="review-notice">
            ⚠ Auto-created from a Zoho project group. Complete the contact data and Save to clear this.
          </div>
        )}
        <div className="drawer__section">
          <span className="drawer__section-label">Client details</span>
          <dl className="drawer__facts">
            {FIELDS.map((field) => (
              <div className="drawer__fact" key={field.key}>
                <dt>{field.label}</dt>
                <dd>{client[field.key] || '—'}</dd>
              </div>
            ))}
            {/* Ancho completo: el nombre del archivo es largo y con media
                columna desbordaba pisando el valor de al lado. */}
            <div className="drawer__fact drawer__fact--wide">
              <dt>MSA on file</dt>
              <dd>
                {client.msaUrl ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleViewMsa}
                    disabled={opening}
                  >
                    <FileText size={14} aria-hidden="true" /> {fileNameFromPath(client.msaUrl)}
                  </button>
                ) : (
                  '—'
                )}
                {msaMsg && <p className="drawer__empty">{msaMsg}</p>}
              </dd>
            </div>
            <div className="drawer__fact">
              <dt>Created</dt>
              <dd>{formatDateTime(client.createdAt)}</dd>
            </div>
          </dl>
        </div>

        {canEdit && (
          <div className="drawer__actions">
            <button type="button" className="btn btn--pay drawer__advance" onClick={onEdit}>
              <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
              Edit
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
