import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { formatRelativeTime } from '../lib/format'

/**
 * Texto "Última actualización: hace 7 min" + botón de historial (icono reloj).
 * El texto relativo se recalcula solo cada 30 s para que quede "en vivo" sin
 * depender de nuevas cargas de datos.
 *
 * @param {{ status: import('../lib/data').SyncStatus | null, onOpenLog: () => void }} props
 */
export function SyncStatus({ status, onOpenLog }) {
  // Tick periódico → fuerza re-render para refrescar el "hace N min".
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const relative = status?.lastSyncedAt
    ? formatRelativeTime(status.lastSyncedAt)
    : null
  const hadError = status?.lastStatus === 'Error'

  return (
    <div className="sync-status">
      <span
        className={`sync-status__text${hadError ? ' sync-status__text--error' : ''}`}
        title={
          hadError && status?.lastErrorMessage
            ? `Último sync con error: ${status.lastErrorMessage}`
            : undefined
        }
      >
        {relative ? (
          <>
            Última actualización:{' '}
            <strong className="sync-status__value">{relative}</strong>
            {hadError && ' · con error'}
          </>
        ) : (
          'Sin sincronizaciones aún'
        )}
      </span>
      <button
        type="button"
        className="icon-btn sync-status__history"
        onClick={onOpenLog}
        aria-label="Ver historial de sincronizaciones"
        title="Ver historial de sincronizaciones"
      >
        <History size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
