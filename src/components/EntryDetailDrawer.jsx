import { useEffect } from 'react'
import { X } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { BillingBadge } from './BillingBadge'
import { Avatar } from './Avatar'
import { formatDate, formatWeek, formatHours } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

/**
 * Drawer lateral con TODOS los detalles de una hora cargada. Se abre desde el
 * botón de detalle de cada fila en Entries. Es sólo lectura: la clasificación se
 * hace desde la grilla (selección + Apply), no acá.
 *
 * allocationLabel y billingStatus se pasan ya resueltos desde la página para no
 * duplicar el mapa de allocations ni la lectura de facturas en este componente.
 *
 * entryCount > 1 marca que la "entry" es el representante de una fila agregada
 * (varias horas de la misma terna en una semana, como en Billing): en ese caso se
 * muestra el conteo en vez de la fecha de una sola sub-entry, y las horas ya vienen
 * sumadas desde el llamador. billingStatus null oculta el dato de Billing (para
 * allocations que no se facturan al cliente: overage / SP internal / X).
 *
 * @param {{
 *   entry: import('../lib/data').TimeEntry,
 *   allocationLabel: ?{ label: string, cls: string },
 *   billingStatus: ?string,
 *   entryCount: ?number,
 *   onClose: () => void,
 * }} props
 */
export function EntryDetailDrawer({ entry, allocationLabel, billingStatus, entryCount, onClose }) {
  const aggregate = entryCount > 1
  useScrollLock()

  // Cierre con Escape (mismo patrón que los otros drawers).
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="drawer-backdrop drawer-backdrop--enter" onClick={onClose}>
      <aside
        className="drawer drawer--enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Time entry</span>
            <h2 className="drawer__title" id="entry-drawer-title">
              {entry.task || entry.project || `Entry ${entry.id}`}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer__provider">
          <Avatar name={entry.user} size="md" />
          <div className="drawer__provider-id">
            <span className="drawer__provider-name">{entry.user}</span>
            {/* Sin subtítulo de rol: la hora no trae el rol del usuario y
                "Contractor" fijo etiquetaría mal a staff/admin/SP-internal. */}
          </div>
          <StatusBadge status={entry.status} />
        </div>

        <dl className="drawer__facts">
          <div className="drawer__fact">
            <dt>Client</dt>
            <dd>{entry.client || '—'}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Project</dt>
            <dd>{entry.project || '—'}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Task</dt>
            <dd>{entry.task || '—'}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Task number</dt>
            <dd>{entry.taskNumber || '—'}</dd>
          </div>
          {aggregate ? (
            // Fila agregada: la fecha de una sola sub-entry no representa la fila
            // (abarca varios días de la semana). Se muestra el conteo; la semana,
            // que sí es compartida, se conserva abajo.
            <div className="drawer__fact">
              <dt>Entries</dt>
              <dd>{entryCount} in this week</dd>
            </div>
          ) : (
            <div className="drawer__fact">
              <dt>Date</dt>
              <dd>{entry.date ? formatDate(entry.date) : '—'}</dd>
            </div>
          )}
          <div className="drawer__fact">
            <dt>Week</dt>
            <dd>{entry.date ? formatWeek(entry.date) : '—'}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Hours</dt>
            <dd>{formatHours(entry.hours)} h</dd>
          </div>
          <div className="drawer__fact">
            <dt>Allocation</dt>
            <dd>
              {allocationLabel ? (
                <span className={`badge ${allocationLabel.cls}`}>{allocationLabel.label}</span>
              ) : (
                <span className="badge badge--pending">— unallocated —</span>
              )}
            </dd>
          </div>
          {billingStatus != null && (
            <div className="drawer__fact">
              <dt>Billing</dt>
              <dd>
                <BillingBadge status={billingStatus} />
              </dd>
            </div>
          )}
        </dl>

        {entry.description && (
          <div className="drawer__notes">
            <span className="drawer__section-label">Description</span>
            <p>{entry.description}</p>
          </div>
        )}

        {entry.notes && (
          <div className="drawer__notes">
            <span className="drawer__section-label">Notes</span>
            <p>{entry.notes}</p>
          </div>
        )}
      </aside>
    </div>
  )
}
