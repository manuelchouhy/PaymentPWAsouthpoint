import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Info } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate, formatHours, formatWeek } from '../lib/format'
import { useEntryFilters, applyEntryFilters, buildFilterOptions, UNALLOCATED } from '../lib/useEntryFilters'
import { deriveEntriesClient } from '../lib/entryClient'
import { isEntryFrozen } from '../lib/entryFreeze'
import { paidEntryIdsFrom } from '../lib/paymentsData'
import { exportGrid } from '../lib/exportGrid'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { Checkbox } from '../components/Checkbox'
import { ExportDropdown } from '../components/ExportDropdown'
import { StatusBadge } from '../components/StatusBadge'
import { BillingBadge } from '../components/BillingBadge'
import { EntryDetailDrawer } from '../components/EntryDetailDrawer'
// Mapa allocation → etiqueta/clase, compartido con Billing (ver src/lib/allocations).
// Clases propias (definidas en index.css): reusar las de billing/status haría que
// "SP internal" se viera igual que "sin clasificar" y que "bill to client" se
// confundiera con la columna Billing, que significa otra cosa.
import { ALLOCATION_LABELS } from '../lib/allocations'

const PAGE_SIZE = 100

// null = sin clasificar. El triage es 100% manual (ver PRD, "Entries"): ninguna
// hora llega con allocation puesta.

// Opciones fijas del filtro de allocation (no se derivan de las entries). Incluye
// UNALLOCATED (sin clasificar, null) y 'unknown' (la categoría X, allocation real
// desde el CHECK 0034). Son cosas distintas: UNALLOCATED = sin triagear; X =
// clasificada explícitamente como "no encaja en las otras".
const ALLOCATION_FILTER_OPTIONS = [UNALLOCATED, 'bill_to_client', 'overage', 'sp_internal', 'unknown']

// Etiqueta visible de una allocation, usada por el filtro y el export. null o el
// centinela UNALLOCATED → "unallocated" (sin clasificar); 'unknown' → "X" (vía
// ALLOCATION_LABELS). Tolera claves desconocidas cayendo al valor crudo en vez de
// romper — el export hacía `[value].label` sin guardas y crasheaba.
const allocationLabel = (value) =>
  value == null || value === UNALLOCATED
    ? 'unallocated'
    : ALLOCATION_LABELS[value]?.label ?? value

export function EntriesPage() {
  const { user, can } = useOutletContext()
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Hora abierta en el drawer de detalle (null = cerrado).
  const [detailEntry, setDetailEntry] = useState(null)
  const [allocationChoice, setAllocationChoice] = useState('bill_to_client')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  // Resultado de un Apply exitoso: qué allocation se aplicó y a cuántas horas,
  // para el aviso con link a Billing. null = no hay Apply reciente que mostrar.
  const [applyNotice, setApplyNotice] = useState(null)
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  // Pagos: para congelar las horas de overage ya pagadas (entryFreeze).
  const [payments, setPayments] = useState([])
  const [status, setStatus] = useState('loading')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [reloadKey, setReloadKey] = useState(0)
  // Client Summary linkea acá con ?client=/?project=: llegar a la grilla sin
  // filtrar obligaría a rehacer a mano el filtro que ya estaba puesto allá.
  const [searchParams] = useSearchParams()
  const initialFilters = useMemo(() => {
    // getAll: un cliente comercial puede agrupar varios nombres de Zoho, y
    // Client Summary los manda todos.
    //
    // filter(Boolean): un `?client=` vacío (bookmark viejo, URL editada a mano)
    // dejaría clients: [''] y, como el filtro hace includes(entry.client), la
    // grilla saldría en cero sin forma visible de destildarlo — el dropdown sólo
    // lista valores que existen en las entries.
    const clientParams = searchParams.getAll('client').filter(Boolean)
    const projectParams = searchParams.getAll('project').filter(Boolean)
    // contractor: lo mandan las tabs de Billing junto con la allocation, para caer
    // en el MISMO set que muestra la tab (Billing filtra por contractor).
    const contractorParams = searchParams.getAll('contractor').filter(Boolean)
    // allocation: lo mandan las tabs de lectura de Billing (Overage/SP internal/X)
    // para reclasificar acá. Se valida contra la MISMA lista del filtro
    // (ALLOCATION_FILTER_OPTIONS, incluye UNALLOCATED y 'unknown'=X) para que no se
    // desincronice, por si la URL viene editada a mano.
    const allocParams = searchParams.getAll('allocation').filter((a) => ALLOCATION_FILTER_OPTIONS.includes(a))
    if (!clientParams.length && !projectParams.length && !contractorParams.length && !allocParams.length) {
      return undefined
    }
    return {
      clients: clientParams,
      projects: projectParams,
      contractors: contractorParams,
      allocations: allocParams,
    }
    // Sólo el valor inicial: si se recalculara, cambiar el filtro a mano y
    // volver atrás en el historial lo pisaría.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { filters, toggleValue, setField, clear, isActive } = useEntryFilters(initialFilters)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // Proyectos y clientes son sólo para derivar el cliente de cada hora
    // (deriveEntriesClient: hora→proyecto por id de Zoho→grupo→cliente por alias;
    // ver entryClient.js). Van en el mismo Promise.all: sin ellos la columna y el
    // filtro de Cliente quedan vacíos, que es justamente lo que se arregla.
    Promise.all([
      api.timeEntries.list(),
      api.invoices.list(),
      api.projects.list(),
      api.clients.list(),
      api.payments.list(),
    ])
      .then(([entryRows, invoiceRows, projectRows, clientRows, paymentRows]) => {
        if (cancelled) return
        setEntries(deriveEntriesClient(entryRows, projectRows, clientRows))
        setInvoices(invoiceRows)
        setPayments(paymentRows)
        // Los datos se releyeron: una selección armada sobre la tanda anterior
        // puede apuntar a filas que ya se facturaron.
        setSelectedIds(new Set())
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar las horas:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // id de entry -> factura, para resolver Billing status sin recorrer las
  // facturas por cada fila.
  const invoiceByEntryId = useMemo(() => {
    const map = new Map()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds ?? []) map.set(String(entryId), invoice)
    }
    return map
  }, [invoices])

  // Listas entrelazadas: cada dropdown se arma sobre lo que pasa los otros
  // filtros (ver buildFilterOptions), así elegir un proyecto recorta la lista de
  // contractors a los que cargaron horas ahí. La semana sí puede vaciarlas —
  // está documentado en buildFilterOptions.
  const options = useMemo(
    () => buildFilterOptions(entries, filters, invoiceByEntryId),
    [entries, filters, invoiceByEntryId],
  )

  const visible = useMemo(() => {
    const filtered = applyEntryFilters(entries, filters, invoiceByEntryId)
    // Las sin clasificar primero SIEMPRE — son las que hay que triagear, y si
    // se mezclaran con las ya clasificadas se perderían de vista. Dentro de
    // cada grupo, la más reciente primero.
    return [...filtered].sort((a, b) => {
      const aPending = a.allocation == null
      const bPending = b.allocation == null
      if (aPending !== bPending) return aPending ? -1 : 1
      return (b.date ?? '').localeCompare(a.date ?? '')
    })
  }, [entries, filters, invoiceByEntryId])

  // Al cambiar los filtros se vuelve a la primera tanda: mantener el "ver más"
  // acumulado de la búsqueda anterior mostraría un conteo que no se pidió.
  // La selección se limpia por el mismo motivo: la barra suma horas sobre lo
  // visible, así que arrastrar filas de otro filtro mostraría "0.0 h · 40
  // entries" y Apply escribiría sobre 40 filas que ya no están en pantalla.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setSelectedIds(new Set())
    // El error y el aviso hablan de la selección anterior: dejarlos colgados
    // bajo otra grilla filtrada hace desconfiar de allocations que sí se
    // guardaron.
    setApplyError('')
    setApplyNotice(null)
  }, [filters])

  const page = visible.slice(0, visibleCount)
  const unallocatedCount = visible.filter((e) => e.allocation == null).length
  const canAllocate = can('entries.allocate')

  // Congelada = no se reclasifica: la hora ya está comprometida (facturada o
  // pagada). Antes de eso se corrige libremente — arreglar una clasificación mal
  // hecha es parte del triage. Ver entryFreeze.js. invoicedEntryIds = claves de
  // invoiceByEntryId (toda hora en una factura); paidEntryIds = horas cubiertas por
  // un pago de overage (una hora de overage pagada ya no se reclasifica).
  const invoicedEntryIds = useMemo(() => new Set(invoiceByEntryId.keys()), [invoiceByEntryId])
  const paidEntryIds = useMemo(() => paidEntryIdsFrom(payments), [payments])
  const isFrozen = (entry) => isEntryFrozen(entry, { invoicedEntryIds, paidEntryIds })
  const selectableOnPage = page.filter((e) => !isFrozen(e))
  const allPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((e) => selectedIds.has(e.id))

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) selectableOnPage.forEach((e) => next.delete(e.id))
      else selectableOnPage.forEach((e) => next.add(e.id))
      return next
    })
  }

  const selectedEntries = visible.filter((e) => selectedIds.has(e.id))
  const selectedHours = selectedEntries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0)

  function handleExport(format) {
    const cols = [
      { header: 'User', key: 'user' },
      { header: 'Project', key: 'project' },
      { header: 'Client', key: 'client' },
      { header: 'Task', key: 'task' },
      { header: 'Date', key: 'date' },
      { header: 'Week', key: 'week' },
      { header: 'Hours', key: 'hours' },
      { header: 'Status', key: 'status' },
      { header: 'Allocation', key: 'allocation' },
      { header: 'Billing', key: 'billing' },
    ]
    // Se exporta `visible` (todo lo filtrado), no `page`: el "Show more" es una
    // decisión de cuánto renderizar, no un filtro — quien exporta con un filtro
    // puesto espera el filtro entero, no las primeras 100 filas.
    const exportRows = visible.map((entry) => ({
      user: entry.user,
      project: entry.project ?? '',
      client: entry.client ?? '',
      task: entry.task ?? '',
      date: entry.date ? formatDate(entry.date) : '',
      week: entry.date ? formatWeek(entry.date) : '',
      hours: Number(entry.hours) || 0,
      status: entry.status,
      // Mismo texto que la grilla, incluido el "unallocated": una celda vacía
      // en el Excel se leería como "no se exportó", no como "sin clasificar".
      allocation: allocationLabel(entry.allocation),
      billing: invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending',
    }))
    exportGrid({
      rows: exportRows,
      columns: cols,
      title: 'Entries',
      gridName: 'entries',
      format,
      generatedBy: user?.email ?? '',
    })
  }

  async function handleApply() {
    // Se manda sólo lo que sigue visible y reclasificable, no el Set crudo: es
    // lo que el usuario ve sumado en la barra.
    const ids = selectedEntries.filter((e) => !isFrozen(e)).map((e) => e.id)
    if (!ids.length || applying) return
    // allocationChoice es siempre una allocation real (bill_to_client / overage /
    // sp_internal / unknown=X): ya no hay opción de "sin clasificar" en el dropdown.
    // Horas por id, leídas de la selección ANTES de limpiarla, para poder sumar
    // en el aviso sólo las filas que la base confirme.
    const hoursById = new Map(selectedEntries.map((e) => [String(e.id), Number(e.hours) || 0]))
    setApplying(true)
    setApplyError('')
    setApplyNotice(null)
    try {
      const result = await api.timeEntries.setAllocation(
        ids,
        allocationChoice,
        user?.email ?? null,
      )
      const updatedIds = result?.updatedIds ?? []
      // Se refleja en la grilla sin recargar todo: el update ya se confirmó y
      // volver a traer 500+ filas por un cambio de columna es desproporcionado.
      // Se pintan sólo las filas que la base confirmó, no las pedidas.
      const applied = new Set(updatedIds.map(String))
      setEntries((prev) =>
        prev.map((e) => (applied.has(String(e.id)) ? { ...e, allocation: allocationChoice } : e)),
      )
      setSelectedIds(new Set())

      // Aviso de lo que SÍ entró (independiente del bloque de faltantes de
      // abajo): confirma que la hora entró al circuito y, para bill to client,
      // linkea a Billing. Las horas se suman de la confirmación de la base.
      if (applied.size > 0) {
        const appliedHours = updatedIds.reduce((sum, id) => sum + (hoursById.get(String(id)) || 0), 0)
        setApplyNotice({ allocation: allocationChoice, count: applied.size, hours: appliedHours })
      }

      // Los motivos NO se suman en un único "N no se aplicaron": cada uno pide
      // una acción distinta (resignarse, reintentar, revisar la sesión), y
      // atribuir el total a uno solo manda al usuario a la acción equivocada.
      const missing = ids.length - applied.size
      const frozen = result?.skippedFrozen ?? 0
      const unconfirmed = result?.unconfirmed ?? 0
      const rejected = Math.max(0, missing - frozen - unconfirmed)
      if (missing > 0) {
        const parts = []
        if (frozen) parts.push(`${frozen} already invoiced (those can never be reclassified)`)
        if (rejected) parts.push(`${rejected} rejected by the server — select them again and retry`)
        if (unconfirmed) {
          parts.push(
            `${unconfirmed} were not saved and the database gave no reason — they may no longer exist, or your session may have expired`,
          )
        }
        setApplyError(
          `${missing} of ${ids.length} ${missing === 1 ? 'entry was' : 'entries were'} not reclassified: ${parts.join('; ')}.`,
        )
        setReloadKey((k) => k + 1)
      }
    } catch (error) {
      console.error('No se pudo aplicar la allocation:', error)
      // Una excepción acá significa que no se escribió NADA: los fallos
      // parciales vuelven por `failures`, no por throw. Por eso no se fuerza
      // una relectura — no hay nada nuevo que traer, y si lo que falló fue la
      // red, el reload dejaría la pantalla en "Could not load entries" sobre
      // una operación que no cambió un solo dato.
      setApplyError('Could not apply the allocation — nothing was changed. Please try again.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">Hour triage</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Entries</h1>
        <p className="masthead__sub">
          Every logged hour, classified by hand. Unallocated hours come first — nothing is
          classified automatically.
        </p>
      </motion.header>

      {/* Fuera del bloque `ready`: este aviso lo dispara un Apply que además
          fuerza una relectura, así que si viviera adentro de la grilla el
          "Loading entries…" lo taparía justo cuando hay que leerlo. No se
          limpia al terminar la relectura porque no es un estado transitorio,
          es el resultado del Apply.
          Tampoco se calla si la relectura falla: es justo cuando más hace
          falta, porque es lo único que dice qué pasó con las filas que no se
          escribieron ("40 de 250 ya estaban facturadas").
          Sin sufijo aclaratorio, a diferencia del aviso de BillingPage: acá el
          único camino que deja `applyError` seteado y además fuerza la
          relectura es el de falla parcial, así que un "lo que falló fue la
          recarga" quedaría pegado justo al mensaje que reporta qué filas no se
          guardaron, negándolo. */}
      {applyError && <p className="field__error">{applyError}</p>}

      {/* Aviso de un Apply exitoso: confirma que la hora entró al circuito. Para
          bill to client linkea a Billing (ya facturable); para el resto
          (overage/SP internal/X) aclara que no se le cobran al cliente y que se ven
          en su tab de Billing una vez aprobadas. Convive con applyError: uno
          reporta lo que entró, el otro lo que no. */}
      {applyNotice && (
        <p className="state__hint">
          {applyNotice.allocation === 'bill_to_client' ? (
            <>
              ✓ {formatHours(applyNotice.hours)} h ({applyNotice.count}{' '}
              {applyNotice.count === 1 ? 'entry' : 'entries'}) classified as bill to client — already
              in <Link to="/billing">Billing ↗</Link>.
            </>
          ) : (
            <>
              ✓ {formatHours(applyNotice.hours)} h ({applyNotice.count}{' '}
              {applyNotice.count === 1 ? 'entry' : 'entries'}) classified as{' '}
              {ALLOCATION_LABELS[applyNotice.allocation]?.label ?? applyNotice.allocation} — not billed to
              the client; shown in its <Link to="/billing">Billing ↗</Link> tab once approved.
            </>
          )}
        </p>
      )}

      {status === 'loading' && <p className="state__hint">Loading entries…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load entries</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
            </div>
            <div className="filterbar__controls">
              <MultiSelectDropdown
                label="Client"
                options={options.clients}
                selected={filters.clients}
                onToggle={(v) => toggleValue('clients', v)}
              />
              <MultiSelectDropdown
                label="Project"
                options={options.projects}
                selected={filters.projects}
                onToggle={(v) => toggleValue('projects', v)}
              />
              <MultiSelectDropdown
                label="Contractor"
                options={options.contractors}
                selected={filters.contractors}
                onToggle={(v) => toggleValue('contractors', v)}
              />
              {/* Opciones fijas, NO entrelazadas (a diferencia de Cliente /
                  Proyecto / Contractor, que se cruzan en buildFilterOptions).
                  Dos motivos: 'unallocated' tiene que seguir tildable aunque no
                  haya ninguna en pantalla, para poder volver a ella; y una
                  categoría vacía bajo otro filtro (Cliente X sin overage → 0
                  filas) es información honesta y recuperable con Clear, el mismo
                  criterio ya aceptado para el filtro de semana. Se asume el
                  "cero sin pista" a cambio de que las categorías fijas
                  (unallocated · bill to client · overage · SP internal · X)
                  estén siempre visibles como referencia. */}
              <MultiSelectDropdown
                label="Allocation"
                options={ALLOCATION_FILTER_OPTIONS}
                selected={filters.allocations}
                onToggle={(v) => toggleValue('allocations', v)}
                getLabel={allocationLabel}
              />
              <div className="filterfield">
                <span className="filterfield__label">Week</span>
                <input
                  type="number"
                  min="1"
                  max="53"
                  className="filterfield__input"
                  value={filters.week}
                  onChange={(e) => setField('week', e.target.value)}
                />
              </div>
              {isActive && (
                <button type="button" className="btn btn--ghost filterbar__clear" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
          </section>

          {/* Debajo de los filtros y ARRIBA de la grilla: con 100 filas por
              página, al pie quedaba fuera de la vista justo después de tildar
              las filas de arriba, y había que bajar para encontrar el Apply. */}
          {canAllocate && selectedIds.size > 0 && (
            <div className="selbar">
              <span className="selbar__count">
                Selected: <b>{formatHours(selectedHours)} h</b> · {selectedIds.size}{' '}
                {selectedIds.size === 1 ? 'entry' : 'entries'}
              </span>
              <div className="selbar__action">
                <span className="selbar__label">Set allocation</span>
                <select
                  className="field__input"
                  value={allocationChoice}
                  onChange={(e) => setAllocationChoice(e.target.value)}
                  aria-label="Allocation to apply"
                >
                  {/* Incluye X (allocation 'unknown') vía ALLOCATION_LABELS. Ya no
                      hay opción "— sin clasificar": el usuario pidió reemplazarla
                      por X. Clasificar es siempre poner una allocation real. */}
                  {Object.entries(ALLOCATION_LABELS).map(([value, { label }]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button type="button" className="btn btn--pay btn--sm" onClick={handleApply} disabled={applying}>
                  {applying ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setSelectedIds(new Set())
                    setApplyError('')
                  }}
                  disabled={applying}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="toolbar">
            <span className="toolbar__count">
              {visible.length} {visible.length === 1 ? 'entry' : 'entries'}
              {page.length < visible.length && ` · showing 1–${page.length}`}
              {unallocatedCount > 0 && ` · ${unallocatedCount} unallocated`}
            </span>
            {visible.length > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {visible.length === 0 ? (
            <div className="empty">No entries to display.</div>
          ) : (
            <>
              <div className="table-wrap table-wrap--scroll">
                <table className="table proj-table entries-table">
                  <thead>
                    <tr>
                      {canAllocate && (
                        <th scope="col" style={{ width: 34 }}>
                          <Checkbox
                            checked={allPageSelected}
                            indeterminate={
                              !allPageSelected &&
                              selectableOnPage.some((e) => selectedIds.has(e.id))
                            }
                            onChange={() => toggleAllOnPage()}
                            disabled={selectableOnPage.length === 0}
                            ariaLabel="Select all selectable rows on this page"
                          />
                        </th>
                      )}
                      <th scope="col">User</th>
                      <th scope="col" className="col-project">Project</th>
                      <th scope="col">Client</th>
                      <th scope="col" className="col-task">Task</th>
                      <th scope="col">Date</th>
                      <th scope="col">Week</th>
                      <th scope="col" className="col-num">Hours</th>
                      <th scope="col">Status</th>
                      <th scope="col">Allocation</th>
                      <th scope="col">Billing</th>
                      <th scope="col" style={{ width: 34 }}>
                        <span className="sr-only">Detail</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((entry) => {
                      const allocation = entry.allocation ? ALLOCATION_LABELS[entry.allocation] : null
                      const billingStatus = invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending'
                      const frozen = isFrozen(entry)
                      // Una fila es seleccionable si el usuario puede clasificar y
                      // la hora no está congelada (ya facturada). Sólo esas responden
                      // al click en la fila.
                      const selectable = canAllocate && !frozen
                      return (
                        <tr
                          key={entry.id}
                          className={selectable ? 'row-selectable' : undefined}
                          // Si el usuario venía seleccionando texto (click-drag),
                          // no se togglea: el mouseup no debe robar esa acción.
                          onClick={
                            selectable
                              ? () => {
                                  if (window.getSelection()?.toString()) return
                                  toggleRow(entry.id)
                                }
                              : undefined
                          }
                          // data-selected en vez de aria-selected: en una <table>
                          // estática aria-selected es inerte para lectores y lo
                          // marcan los linters de a11y; acá sólo es hook de estilo.
                          data-selected={selectable ? selectedIds.has(entry.id) : undefined}
                        >
                          {canAllocate && (
                            // El click en la celda del checkbox no debe además
                            // disparar el onClick de la fila (si no, togglea dos
                            // veces y se cancela). onChange sigue funcionando igual.
                            <td
                              onClick={(e) => e.stopPropagation()}
                              title={frozen ? 'Already invoiced — cannot be reclassified' : undefined}
                            >
                              <Checkbox
                                checked={selectedIds.has(entry.id)}
                                onChange={() => toggleRow(entry.id)}
                                disabled={frozen}
                                ariaLabel={`Select entry ${entry.id}`}
                              />
                            </td>
                          )}
                          <td>{entry.user}</td>
                          {/* title: al recortarse con ellipsis, el texto completo
                              queda disponible al pasar el mouse. */}
                          <td className="cell-strong col-project" title={entry.project || ''}>
                            {entry.project || '—'}
                          </td>
                          <td className="cell-soft">{entry.client || '—'}</td>
                          <td className="cell-soft col-task" title={entry.task || ''}>
                            {entry.task || '—'}
                          </td>
                          <td className="cell-mono">{entry.date ? formatDate(entry.date) : '—'}</td>
                          <td className="cell-mono">{entry.date ? formatWeek(entry.date) : '—'}</td>
                          <td className="col-num cell-mono">{formatHours(entry.hours)}</td>
                          <td>
                            <StatusBadge status={entry.status} />
                          </td>
                          <td>
                            {allocation ? (
                              <span className={`badge ${allocation.cls}`}>{allocation.label}</span>
                            ) : (
                              <span className="badge badge--pending">— unallocated —</span>
                            )}
                          </td>
                          <td>
                            <BillingBadge status={billingStatus} />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="icon-btn"
                              // stopPropagation también en el td (arriba): un click
                              // en el padding de esta celda no debe seleccionar la
                              // fila; sólo el botón abre el detalle.
                              onClick={() => setDetailEntry(entry)}
                              aria-label={`View details of entry ${entry.id}`}
                              title="View details"
                            >
                              <Info size={16} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {visibleCount < visible.length && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  >
                    Show more ({visible.length - visibleCount} left)
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      {(() => {
        if (!detailEntry) return null
        // Se re-busca la entry viva por id: si hubo un reload (Apply, refresh)
        // mientras el drawer estaba abierto, detailEntry apunta al objeto viejo y
        // su allocation quedaría stale mientras el billing se recalcula en vivo.
        // Si la entry ya no existe tras el reload, se cae al objeto capturado.
        const live = entries.find((e) => e.id === detailEntry.id) ?? detailEntry
        return (
          <EntryDetailDrawer
            entry={live}
            allocationLabel={live.allocation ? ALLOCATION_LABELS[live.allocation] : null}
            billingStatus={invoiceByEntryId.get(String(live.id))?.status ?? 'Pending'}
            onClose={() => setDetailEntry(null)}
          />
        )
      })()}
    </>
  )
}
