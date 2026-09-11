import { Fragment, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { buildClientSummaryWeekly, weekLabel } from '../lib/clientSummaryWeekly'
import { useSyncReload } from '../lib/useSyncReload'
import { filterClientSummary } from '../lib/clientSummaryFilter'
import {
  chartTotals,
  portfolioTotals,
  projectRowTotals,
  tableTotalsByClient,
} from '../lib/clientSummaryTotals'
import { buildClientResolver } from '../lib/clientResolver'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'
import { ClientSummaryCharts } from '../components/ClientSummaryCharts'
import { sortedUnique } from '../lib/useEntryFilters'

/** '—' para nulos; si no, horas formateadas. */
function hoursOrDash(value) {
  return value == null ? '—' : formatHours(value)
}

/**
 * Redondea a 1 decimal para el export, manteniendo el tipo numérico (para que la
 * planilla pueda sumar) y evitando los artefactos de float (10.1000000001) que
 * aparecerían al exportar la suma acumulada cruda. Los no-números (celda vacía)
 * pasan tal cual. Coincide con lo que muestra formatHours en la grilla.
 */
function num1(value) {
  return typeof value === 'number' ? Math.round(value * 10) / 10 : value
}

// --- className de celdas numéricas -------------------------------------------
// Un solo criterio para TODA la grilla, así el estilo nunca contradice el texto
// ni difiere entre columnas (la tabla se leía "entreverada" con todo del mismo
// peso). Reglas:
//   - se decide sobre el valor REDONDEADO a 1 decimal (igual que formatHours),
//     de modo que un '0.0' mostrado siempre se ve atenuado (no importa si el
//     crudo era 0.04);
//   - cero o nulo ('—') → atenuado (cell-quiet), en todas las columnas por igual;
//   - kind 'overage' → ámbar si hay sobreconsumo; kind 'remaining' → rojo si es
//     negativo (sobre budget).
function hoursCellClass(value, kind = 'plain') {
  const base = 'col-num cell-mono'
  const r = num1(value) // mismo redondeo que muestra la celda (reusa num1)
  // null/undefined ('—') y NaN → atenuado: cubre el invariante "un 0.0 mostrado
  // siempre se ve atenuado" (formatHours(NaN) también imprime 0.0).
  if (!Number.isFinite(r)) return `${base} cell-quiet`
  if (kind === 'overage') return r > 0 ? `${base} cell-over` : `${base} cell-quiet`
  // Signo del valor CRUDO (no del redondeado): un remaining de -0.03 se muestra
  // como "-0.0" (negativo a la vista), así que va en rojo, no atenuado; num1
  // lo redondearía a -0 y perdería el signo.
  if (kind === 'remaining' && value < 0) return `${base} cell-neg`
  return r === 0 ? `${base} cell-quiet` : base
}

export function ClientSummaryPage() {
  const { user } = useOutletContext()
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [crsByProject, setCrsByProject] = useState(() => new Map())
  const [clientMasters, setClientMasters] = useState([])
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  useSyncReload(setReloadKey)
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedProjectNumbers, setSelectedProjectNumbers] = useState([])
  const [selectedProjectNames, setSelectedProjectNames] = useState([])
  const [selectedSows, setSelectedSows] = useState([])
  const [selectedWeeks, setSelectedWeeks] = useState([])
  // Proyectos con el desglose por semana desplegado. Colapsados por defecto (Set
  // vacío) para que la tabla arranque corta: 1 fila por proyecto con sus totales.
  const [expandedProjects, setExpandedProjects] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // clients alimenta el resolver grupo→cliente, pero NO es esencial para ver la
    // grilla: si su fetch falla (permisos, modo http sin clients.list, red) se
    // degrada a [] y la agrupación cae al texto legacy. Mismo patrón que ProjectsPage.
    const clientsList = Promise.resolve()
      .then(() => api.clients.list())
      .catch(() => [])
    // Las facturas alimentan el reparto "invoiced" de los gráficos (C11). No son
    // esenciales: si su fetch falla, se degrada a [] y el invoiced cae a 0 sin
    // romper la página (mismo criterio que clients).
    const invoicesList = Promise.resolve()
      .then(() => api.invoices.list())
      .catch(() => [])
    Promise.all([
      api.projects.list(),
      api.timeEntries.list(),
      api.changeRequests.listByProject(),
      clientsList,
      invoicesList,
    ])
      .then(([projectRows, entryRows, crMap, clientRows, invoiceRows]) => {
        if (cancelled) return
        setProjects(projectRows)
        setEntries(entryRows)
        setCrsByProject(crMap)
        setClientMasters(clientRows)
        setInvoices(invoiceRows)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Client Summary:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Cliente resuelto de cada proyecto (cadena manual→grupo→legacy; ver
  // clientResolver, mismo resolver que Entries/Billing/Projects). Un proyecto cuyo
  // grupo de Zoho es "Velociti" resuelve al cliente "GS3" aunque projects.client
  // venga vacío. Se anota aparte para no pisar los campos crudos del sync.
  const resolvedProjects = useMemo(() => {
    const resolve = buildClientResolver(clientMasters)
    return projects.map((p) => ({ ...p, resolvedClient: resolve(p).client ?? '' }))
  }, [projects, clientMasters])

  // Índice entry→factura, igual que Billing: una hora está facturada si aparece en
  // el entryIds de alguna factura. Alimenta el predicado isInvoiced del motor (C11).
  const isInvoiced = useMemo(() => {
    const invoicedIds = new Set()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds ?? []) invoicedIds.add(String(entryId))
    }
    return (entry) => invoicedIds.has(String(entry.id))
  }, [invoices])

  // Toda la agregación semanal (consumed/overage/invoiced/cumulative/remaining por
  // semana, budget del proyecto) vive en el motor puro clientSummaryWeekly. Agrupa
  // por el cliente resuelto (resolvedClient).
  const summary = useMemo(
    () => buildClientSummaryWeekly({ projects: resolvedProjects, entries, crsByProject, isInvoiced }),
    [resolvedProjects, entries, crsByProject, isInvoiced],
  )

  // Opciones de cada filtro, derivadas de la salida COMPLETA del motor (misma
  // fuente que la grilla; no se duplica la regla de agrupación).
  const clientOptions = useMemo(
    () => sortedUnique(summary.clients.map((c) => c.client)),
    [summary],
  )
  const allProjects = useMemo(() => summary.clients.flatMap((c) => c.projects), [summary])
  const projectNumberOptions = useMemo(
    () => sortedUnique(allProjects.map((p) => p.projectNumber)),
    [allProjects],
  )
  const projectNameOptions = useMemo(
    () => sortedUnique(allProjects.map((p) => p.projectName)),
    [allProjects],
  )
  // El SOW del proyecto puede venir coma-separado (multi-stage); las opciones son
  // los SOW individuales.
  const sowOptions = useMemo(
    () => sortedUnique(allProjects.flatMap((p) => p.sowNumbers ?? [])),
    [allProjects],
  )
  // Semanas presentes en cualquier proyecto, rotuladas year-aware y ordenadas por
  // su domingo. El value del filtro es el rótulo (único por semana física).
  const weekOptions = useMemo(() => {
    const byLabel = new Map()
    for (const p of allProjects) {
      for (const w of p.weeks) byLabel.set(weekLabel(w), w.weekStart)
    }
    return [...byLabel.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([label]) => label)
  }, [allProjects])

  // Scope de PROYECTO (Client/Project#/Name/SOW), sin el filtro Week: es la base
  // tanto de la tabla como de los gráficos. Lógica pura en clientSummaryFilter.
  const projectScoped = useMemo(
    () =>
      filterClientSummary(summary.clients, {
        clients: selectedClients,
        projectNumbers: selectedProjectNumbers,
        projectNames: selectedProjectNames,
        sows: selectedSows,
      }),
    [summary, selectedClients, selectedProjectNumbers, selectedProjectNames, selectedSows],
  )

  // La tabla aplica además el filtro Week sobre el scope de proyecto (recorta
  // filas-semana y descarta proyectos/clientes sin semana visible).
  const clients = useMemo(
    () => filterClientSummary(projectScoped, { weeks: selectedWeeks }),
    [projectScoped, selectedWeeks],
  )

  // Totales de la TABLA (agregación pura, testeada en clientSummaryTotals): suman
  // las SEMANAS VISIBLES, así cuadran con las celdas Consumed/Overage mostradas
  // aunque el filtro Week haya recortado filas.
  const clientTotals = useMemo(() => tableTotalsByClient(clients), [clients])
  const totals = useMemo(() => portfolioTotals(clientTotals), [clientTotals])

  // Totales de los GRÁFICOS: foto de estado de budget con horas ALL-TIME por
  // proyecto sobre el scope de PROYECTO (NO se recortan por el filtro Week).
  const chartTotalsValue = useMemo(() => chartTotals(projectScoped), [projectScoped])

  function toggleIn(setter, value) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  function toggleProject(id) {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const anyFilter = [
    selectedClients,
    selectedProjectNumbers,
    selectedProjectNames,
    selectedSows,
    selectedWeeks,
  ].some((a) => a.length > 0)

  function clearAllFilters() {
    setSelectedClients([])
    setSelectedProjectNumbers([])
    setSelectedProjectNames([])
    setSelectedSows([])
    setSelectedWeeks([])
  }

  function handleExport(format) {
    const cols = [
      { header: 'Client', key: 'client' },
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Project', key: 'projectName' },
      { header: 'SOW', key: 'sow' },
      { header: 'Week', key: 'week' },
      { header: 'Status', key: 'status' },
      { header: 'Budget', key: 'budget' },
      { header: 'Consumed', key: 'consumed' },
      { header: 'Pending', key: 'pending' },
      { header: 'Cumulative', key: 'cumulative' },
      { header: 'Remaining', key: 'remaining' },
      { header: 'Overage', key: 'overage' },
    ]
    const rows = []
    for (const group of clients) {
      for (const project of group.projects) {
        const base = {
          client: group.client,
          projectNumber: project.projectNumber ?? '',
          projectName: project.projectName ?? '',
          sow: project.sowNumber ?? '',
          status: project.zohoStatus ?? '',
        }
        // Budget solo en la PRIMERA fila del proyecto: repetirlo por semana haría
        // que sumar la columna Budget en una planilla infle el total × nº semanas.
        if (project.weeks.length === 0) {
          rows.push({ ...base, week: '', budget: num1(project.budget ?? ''), consumed: 0, pending: 0, cumulative: 0, remaining: num1(project.budget ?? ''), overage: 0 })
          continue
        }
        project.weeks.forEach((week, i) => {
          rows.push({
            ...base,
            week: weekLabel(week),
            budget: i === 0 ? num1(project.budget ?? '') : '',
            consumed: num1(week.consumed),
            pending: num1(week.pending),
            cumulative: num1(week.cumulative),
            remaining: num1(week.remaining ?? ''),
            overage: num1(week.overage),
          })
        })
      }
    }
    exportGrid({
      rows,
      columns: cols,
      title: 'Client Summary',
      gridName: 'client-summary',
      format,
      generatedBy: user?.email ?? '',
    })
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
          <span className="masthead__kicker">Client Summary</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Client Summary</h1>
        <p className="masthead__sub">
          Weekly view per project. Budget is the estimated hours (SOW plus approved change
          requests). Consumed counts approved hours — bill-to-client for clients, plus internal
          hours for SouthPoint Internal (no budget); Pending shows those hours not yet approved
          in Zoho; Overage sits in its own column.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading client summary…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load client summary</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <motion.div className="client-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
            </div>
            <div className="filterbar__controls">
              <MultiSelectDropdown
                label="Client"
                options={clientOptions}
                selected={selectedClients}
                onToggle={(v) => toggleIn(setSelectedClients, v)}
              />
              <MultiSelectDropdown
                label="Project #"
                options={projectNumberOptions}
                selected={selectedProjectNumbers}
                onToggle={(v) => toggleIn(setSelectedProjectNumbers, v)}
              />
              <MultiSelectDropdown
                label="Project"
                options={projectNameOptions}
                selected={selectedProjectNames}
                onToggle={(v) => toggleIn(setSelectedProjectNames, v)}
              />
              <MultiSelectDropdown
                label="SOW"
                options={sowOptions}
                selected={selectedSows}
                onToggle={(v) => toggleIn(setSelectedSows, v)}
              />
              <MultiSelectDropdown
                label="Week"
                options={weekOptions}
                selected={selectedWeeks}
                onToggle={(v) => toggleIn(setSelectedWeeks, v)}
              />
              {anyFilter && (
                <button
                  type="button"
                  className="btn btn--ghost filterbar__clear"
                  onClick={clearAllFilters}
                >
                  Clear
                </button>
              )}
            </div>
          </section>

          {/* Los gráficos dependen del scope de PROYECTO, no del filtro Week (que
              solo achica la tabla): se muestran aunque el Week vacíe la grilla.
              Van debajo de los filtros, antes de la grilla. */}
          {projectScoped.length > 0 && <ClientSummaryCharts totals={chartTotalsValue} />}

          <div className="toolbar">
            <span className="toolbar__count">
              {clients.length} {clients.length === 1 ? 'client' : 'clients'}
            </span>
            {clients.length > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {clients.length === 0 ? (
            <div className="empty">No projects to summarise.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Project #</th>
                    <th scope="col">Project</th>
                    <th scope="col">SOW</th>
                    <th scope="col">Week</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="col-num">Budget</th>
                    <th scope="col" className="col-num">Consumed</th>
                    <th scope="col" className="col-num">Pending</th>
                    <th scope="col" className="col-num">Cumulative</th>
                    <th scope="col" className="col-num">Remaining</th>
                    <th scope="col" className="col-num">Overage</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((group) => {
                    const ct = clientTotals.get(group.client)
                    return (
                      <Fragment key={group.client}>
                        <tr className="summary-row--client">
                          <th scope="rowgroup">{group.client}</th>
                          <td colSpan={5} />
                          <td className={hoursCellClass(ct.hasBudget ? ct.budget : null)}>
                            {ct.hasBudget ? formatHours(ct.budget) : '—'}
                          </td>
                          <td className={hoursCellClass(ct.consumed)}>{formatHours(ct.consumed)}</td>
                          <td className={hoursCellClass(ct.pending)}>{formatHours(ct.pending)}</td>
                          <td className="col-num" />
                          <td className="col-num" />
                          <td className={hoursCellClass(ct.overage, 'overage')}>{formatHours(ct.overage)}</td>
                        </tr>
                        {group.projects.map((project) => {
                          // Fila COLAPSADA: una por proyecto, con los totales
                          // (pura, testeada en projectRowTotals). El chevron despliega
                          // el desglose por semana. Colapsado por defecto → tabla corta.
                          const pt = projectRowTotals(project)
                          // weeks local con el mismo guard que projectRowTotals
                          // (?? []), para que ambos call sites traten weeks igual.
                          const weeks = project.weeks ?? []
                          const hasWeeks = weeks.length > 0
                          const open = expandedProjects.has(project.id)
                          const detailId = `cs-weeks-${project.id}`
                          return (
                            <Fragment key={project.id}>
                              <tr
                                className={`cs-project-row${hasWeeks ? ' cs-project-row--expandable' : ''}`}
                                onClick={hasWeeks ? () => toggleProject(project.id) : undefined}
                              >
                                <td />
                                <td className="cell-mono">
                                  <div className="cs-lead">
                                    {hasWeeks ? (
                                      <button
                                        type="button"
                                        className="pay-expand"
                                        // stopPropagation: el <tr> ya togglea; sin esto el
                                        // click dispararía el toggle dos veces (fila + botón).
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          toggleProject(project.id)
                                        }}
                                        aria-expanded={open}
                                        aria-controls={open ? detailId : undefined}
                                        aria-label={open ? 'Hide weekly breakdown' : 'Show weekly breakdown'}
                                      >
                                        {open ? (
                                          <ChevronDown size={15} aria-hidden="true" />
                                        ) : (
                                          <ChevronRight size={15} aria-hidden="true" />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="pay-expand pay-expand--empty" aria-hidden="true" />
                                    )}
                                    <span>{project.projectNumber || '—'}</span>
                                  </div>
                                </td>
                                <td>{project.projectName || '—'}</td>
                                <td className="cell-soft">{project.sowNumber || '—'}</td>
                                {/* En la columna Week, la fila colapsada resume cuántas
                                    semanas hay adentro (o '—' si no hay). */}
                                <td className="cell-soft">
                                  {hasWeeks
                                    ? `${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}`
                                    : '—'}
                                </td>
                                <td className="cell-soft">{project.zohoStatus || '—'}</td>
                                <td className={hoursCellClass(pt.budget)}>{hoursOrDash(pt.budget)}</td>
                                <td className={hoursCellClass(pt.consumed)}>{formatHours(pt.consumed)}</td>
                                <td className={hoursCellClass(pt.pending)}>{formatHours(pt.pending)}</td>
                                <td className={hoursCellClass(pt.cumulative)}>{formatHours(pt.cumulative)}</td>
                                <td className={hoursCellClass(pt.remaining, 'remaining')}>{hoursOrDash(pt.remaining)}</td>
                                <td className={hoursCellClass(pt.overage, 'overage')}>{formatHours(pt.overage)}</td>
                              </tr>
                              {/* Desglose por semana: solo en el DOM cuando está expandida.
                                  La identidad del proyecto queda en la fila padre; acá solo
                                  la semana y sus horas. */}
                              {open &&
                                weeks.map((week, wi) => (
                                  <tr
                                    key={`${project.id}-${week.weekStart}`}
                                    className="cs-week-row"
                                    id={wi === 0 ? detailId : undefined}
                                  >
                                    <td />
                                    <td />
                                    <td />
                                    <td />
                                    <td className="cell-mono cs-week-label">{weekLabel(week)}</td>
                                    <td />
                                    <td className="col-num" />
                                    <td className={hoursCellClass(week.consumed)}>{formatHours(week.consumed)}</td>
                                    <td className={hoursCellClass(week.pending)}>{formatHours(week.pending)}</td>
                                    <td className={hoursCellClass(week.cumulative)}>{formatHours(week.cumulative)}</td>
                                    <td className={hoursCellClass(week.remaining, 'remaining')}>{hoursOrDash(week.remaining)}</td>
                                    <td className={hoursCellClass(week.overage, 'overage')}>{formatHours(week.overage)}</td>
                                  </tr>
                                ))}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                  <tr className="summary-row--total">
                    <th scope="row">Total portfolio</th>
                    <td colSpan={5} />
                    <td className={hoursCellClass(totals.hasBudget ? totals.budget : null)}>
                      {totals.hasBudget ? formatHours(totals.budget) : '—'}
                    </td>
                    <td className={hoursCellClass(totals.consumed)}>{formatHours(totals.consumed)}</td>
                    <td className={hoursCellClass(totals.pending)}>{formatHours(totals.pending)}</td>
                    <td className="col-num" />
                    <td className="col-num" />
                    <td className={hoursCellClass(totals.overage, 'overage')}>{formatHours(totals.overage)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}
    </>
  )
}
