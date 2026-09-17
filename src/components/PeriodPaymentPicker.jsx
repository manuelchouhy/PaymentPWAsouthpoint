import { bucketEntriesByPeriod, sumHours } from '../lib/paymentsPeriodBuckets'
import { entryPaymentStatus } from '../lib/entryPaymentStatus'
import { formatDate, formatHours } from '../lib/format'

/**
 * Picker de horas a pagar por PERÍODO (Total / By month / By week + checkboxes por hora),
 * compartido por el pago de factura (por contractor) y el invoice-less (overage / SP internal).
 * Sólo AGRUPA/selecciona; el pago es siempre por los `entry_id` tildados (selectedIds). Las horas
 * ya pagadas van read-only (checkbox deshabilitado). Ver "Pago a contractor / Cobertura" en
 * CONTEXT.md y paymentsPeriodBuckets.js.
 *
 * @param {object[]} entries        horas ofrecidas (las PENDIENTES de la línea/grupo).
 * @param {Set<string>} selectedIds ids (string) tildados.
 * @param {(id:(string|number))=>void} onToggleId    togglea una hora.
 * @param {(ids:string[])=>void} onToggleIds         togglea un bucket entero (ids ya calculados).
 * @param {'total'|'month'|'week'} periodMode
 * @param {(mode:string)=>void} onPeriodMode
 * @param {Set<string>} paidEntryIds  horas ya pagadas (para el estado de cada fila).
 * @param {number} selectedCount      para el aviso "seleccioná al menos una".
 * @param {boolean} [wholeLine]       modo línea-entera: hay horas pendientes NO cargadas en esta
 *                                    vista (cap de sync), así que no se puede tildar un subconjunto
 *                                    honesto — se paga la línea pendiente completa. Muestra una nota
 *                                    en vez del selector por hora. Sólo lo usa el pago de factura.
 * @param {number} [wholeLineHours]   horas totales que se pagarán en modo línea-entera (para la nota).
 * @param {number} [unloadedCount]    cuántas horas pendientes no están cargadas (para la nota).
 */
export function PeriodPaymentPicker({
  entries,
  selectedIds,
  onToggleId,
  onToggleIds,
  periodMode,
  onPeriodMode,
  paidEntryIds,
  selectedCount,
  wholeLine = false,
  wholeLineHours,
  unloadedCount,
}) {
  if (wholeLine) {
    // No se puede ofrecer selección por período/hora: parte de las horas pendientes no están
    // cargadas (fuera del cap de sync). Se paga la línea pendiente completa; el aviso es explícito
    // para no dar la falsa impresión de un pago parcial (destildar lo visible no evita pagar lo
    // no cargado). Ver handlePayContractor.
    return (
      <div className="overage-picker">
        <span className="overage-picker__title">Hours to pay</span>
        <p className="overage-picker__empty">
          {unloadedCount > 0
            ? `${unloadedCount} of this line's pending hours aren't loaded in this view, so a partial selection isn't possible here. `
            : "This line's pending hours aren't fully loaded in this view, so a partial selection isn't possible here. "}
          The full remaining line
          {Number.isFinite(wholeLineHours) ? ` (${formatHours(wholeLineHours)} h)` : ''} will be paid.
        </p>
      </div>
    )
  }
  const isPending = (e) => entryPaymentStatus(e, paidEntryIds) === 'pending'
  // Buckets sólo en month/week (en 'total' la lista es plana, sin agrupar).
  const buckets = periodMode === 'total' ? [] : bucketEntriesByPeriod(entries, periodMode)

  const renderEntryRow = (e) => {
    const status = entryPaymentStatus(e, paidEntryIds)
    const isPaid = status === 'paid'
    return (
      <li key={e.id}>
        <label className={`overage-picker__row${isPaid ? ' overage-picker__row--paid' : ''}`}>
          <input
            type="checkbox"
            checked={selectedIds.has(String(e.id))}
            disabled={isPaid}
            onChange={() => onToggleId(e.id)}
          />
          <span className="overage-picker__desc">
            {e.project || '—'}
            {e.task ? ` · ${e.task}` : ''}
            {e.date ? ` · ${formatDate(e.date)}` : ''}
          </span>
          <span className="overage-picker__hours">{formatHours(e.hours)} h</span>
          <span className={`badge badge--${status}`}>{isPaid ? 'Paid' : 'Pending'}</span>
        </label>
      </li>
    )
  }

  return (
    <div className="overage-picker">
      <div className="overage-picker__modes" role="group" aria-label="Pay by period">
        {[
          ['total', 'Total'],
          ['month', 'By month'],
          ['week', 'By week'],
        ].map(([mode, modeLabel]) => (
          <button
            key={mode}
            type="button"
            className={`overage-picker__mode${periodMode === mode ? ' is-active' : ''}`}
            aria-pressed={periodMode === mode}
            onClick={() => onPeriodMode(mode)}
          >
            {modeLabel}
          </button>
        ))}
      </div>
      <span className="overage-picker__title">Hours to pay</span>
      {entries.length === 0 ? (
        // Sin horas cargadas en esta vista (p. ej. una factura vieja fuera del cap de sync): no hay
        // filas individuales para tildar. El pago cubre igual la línea pendiente completa; el
        // resumen del modal muestra las horas/entries a pagar.
        <p className="overage-picker__empty">
          No individual hours loaded in this view. The full remaining line will be paid.
        </p>
      ) : periodMode === 'total' ? (
        <ul className="overage-picker__list">{entries.map(renderEntryRow)}</ul>
      ) : (
        buckets.map((bucket) => {
          // Header muestra las horas PENDIENTES del bucket (lo pagable); "seleccionar todo" del
          // bucket sólo tilda las pendientes (las pagadas van read-only).
          const pending = bucket.entries.filter(isPending)
          const pendIds = pending.map((e) => String(e.id))
          const pendHours = sumHours(pending)
          const allSel = pendIds.length > 0 && pendIds.every((id) => selectedIds.has(id))
          const someSel = pendIds.some((id) => selectedIds.has(id))
          const empty = pendIds.length === 0
          return (
            <div key={bucket.key} className="overage-picker__bucket">
              <label
                className={`overage-picker__bucket-head${empty ? ' overage-picker__bucket-head--empty' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSel && someSel
                  }}
                  disabled={empty}
                  onChange={() => onToggleIds(pendIds)}
                />
                <span className="overage-picker__bucket-label">{bucket.label}</span>
                <span className="overage-picker__bucket-hours">{formatHours(pendHours)} h</span>
              </label>
              <ul className="overage-picker__list">{bucket.entries.map(renderEntryRow)}</ul>
            </div>
          )
        })
      )}
      {selectedCount === 0 && (
        <span className="field__error">Select at least one hour to pay.</span>
      )}
    </div>
  )
}
