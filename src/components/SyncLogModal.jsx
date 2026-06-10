import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { getSyncLog } from '../lib/data'
import { formatDateTime } from '../lib/format'

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

  // Carga del historial al abrir.
  useEffect(() => {
    let cancelled = false
    setState('loading')
    getSyncLog(50)
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

  // Bloqueo del scroll de fondo + cierre con Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
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
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Sincronización · Zoho</span>
            <h2 className="modal__title" id="synclog-title">
              Historial de sync
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="synclog">
          {state === 'loading' && (
            <p className="synclog__hint">Cargando historial…</p>
          )}

          {state === 'error' && (
            <p className="synclog__hint synclog__hint--error">
              No se pudo cargar el historial.
            </p>
          )}

          {state === 'ready' && entries.length === 0 && (
            <p className="synclog__hint">Todavía no hay corridas registradas.</p>
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
                      {entry.recordsCount === 1 ? 'registro' : 'registros'}
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
