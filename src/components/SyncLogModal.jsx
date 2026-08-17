import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

/**
 * Modal con el historial de las últimas 50 corridas del sync de Zoho.
 * Visible a todos los usuarios autenticados (los roles llegan en FR-11).
 *
 * @param {{ onClose: () => void }} props
 */
export function SyncLogModal({ onClose }) {
  const [entries, setEntries] = useState([])
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'error'
  const dialogRef = useRef(null)

  useScrollLock()

  // Carga del historial al abrir.
  useEffect(() => {
    let cancelled = false
    setState('loading')
    api.sync.getLog(50)
      .then((data) => {
        if (cancelled) return
        setEntries(data)
        setState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar el historial de sync:', error)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Cierre con Escape.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="modal modal--log"
        role="dialog"
        aria-modal="true"
        aria-labelledby="synclog-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Sync · Zoho</span>
            <h2 className="modal__title" id="synclog-title">
              Sync history
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="synclog">
          {state === 'loading' && (
            <p className="synclog__hint">Loading history…</p>
          )}

          {state === 'error' && (
            <p className="synclog__hint synclog__hint--error">
              Could not load the sync history.
            </p>
          )}

          {state === 'ready' && entries.length === 0 && (
            <p className="synclog__hint">No runs recorded yet.</p>
          )}

          {state === 'ready' && entries.length > 0 && (
            <ul className="synclog__list">
              {entries.map((entry) => {
                const ok = entry.status === 'OK'
                return (
                  <li key={entry.id} className="synclog__row">
                    <span
                      className={`synclog__status synclog__status--${
                        ok ? 'ok' : 'error'
                      }`}
                    >
                      {ok ? (
                        <CheckCircle2 size={15} aria-hidden="true" />
                      ) : (
                        <AlertCircle size={15} aria-hidden="true" />
                      )}
                      {ok ? 'OK' : 'Error'}
                    </span>
                    <span className="synclog__when">
                      {formatDateTime(entry.ranAt)}
                    </span>
                    <span className="synclog__count">
                      {entry.recordsCount ?? 0}{' '}
                      {entry.recordsCount === 1 ? 'record' : 'records'}
                    </span>
                    {entry.errorMessage && (
                      <span
                        className="synclog__error"
                        title={entry.errorMessage}
                      >
                        {entry.errorMessage}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
