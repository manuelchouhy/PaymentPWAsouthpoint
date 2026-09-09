import { useEffect, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { formatRelativeTime } from '../lib/format'

/**
 * Texto "Última actualización: hace 7 min" + botón de sync + botón de historial.
 * El texto relativo se recalcula solo cada 30 s para que quede "en vivo" sin
 * depender de nuevas cargas de datos.
 *
 * `onRefresh`/`syncing` son opcionales: si se pasan, se muestra el botón para
 * forzar un sync de Zoho pegado al historial (así vive en el Header global y no
 * solo en la pantalla de Time Entries).
 *
 * @param {{
 *   status: import('../lib/data').SyncStatus | null,
 *   onOpenLog: () => void,
 *   onRefresh?: () => void,
 *   syncing?: boolean,
 * }} props
 */
export function SyncStatus({ status, onOpenLog, onRefresh, syncing = false }) {
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
            ? `Last sync error: ${status.lastErrorMessage}`
            : undefined
        }
      >
        {relative ? (
          <>
            <span
              className={`sync-status__dot${hadError ? ' sync-status__dot--error' : ''}`}
              aria-hidden="true"
            />
            {hadError ? 'Sync error' : 'Synced'}{' '}
            <strong className="sync-status__value">{relative}</strong>
          </>
        ) : (
          'No syncs yet'
        )}
      </span>
      {onRefresh && (
        <button
          type="button"
          className="icon-btn sync-status__refresh"
          onClick={onRefresh}
          disabled={syncing}
          aria-busy={syncing}
          aria-label={syncing ? 'Syncing…' : 'Force a Zoho sync'}
          title="Force a Zoho sync"
        >
          <RefreshCw
            size={16}
            className={syncing ? 'icon-spin' : ''}
            aria-hidden="true"
          />
        </button>
      )}
      <button
        type="button"
        className="icon-btn sync-status__history"
        onClick={onOpenLog}
        aria-label="View sync history"
        title="View sync history"
      >
        <History size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
