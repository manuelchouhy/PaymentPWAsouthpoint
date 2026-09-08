import { Fragment, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { buildClientSummaryWeekly, weekLabel } from '../lib/clientSummaryWeekly'
import { filterClientSummary } from '../lib/clientSummaryFilter'
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

export function ClientSummaryPage() {
  const { user } = useOutletContext()
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [crsByProject, setCrsByProject] = useState(() => new Map())
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedProjectNumbers, setSelectedProjectNumbers] = useState([])
  const [selectedProjectNames, setSelectedProjectNames] = useState([])
  const [selectedSows, setSelectedSows] = useState([])
  const [selectedWeeks, setSelectedWeeks] = useState([])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([
      api.projects.list(),
      api.timeEntries.list(),
      api.changeRequests.listByProject(),
    ])
      .then(([projectRows, entryRows, crMap]) => {
        if (cancelled) return
        setProjects(projectRows)
        setEntries(entryRows)
        setCrsByProject(crMap)
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

  // Toda la agregación semanal (consumed/overage/cumulative/remaining por semana,
  // budget del proyecto, totales) vive en el motor puro clientSummaryWeekly.
  const summary = useMemo(
    () => buildClientSummaryWeekly({ projects, entries, crsByProject }),
    [projects, entries, crsByProject],
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

  // Filtro combinado (AND entre categorías, OR dentro): lógica pura en
  // clientSummaryFilter (testeada aparte). El orden ya lo resuelve el motor.
  const clients = useMemo(
    () =>
      filterClientSummary(summary.clients, {
        clients: selectedClients,
        projectNumbers: selectedProjectNumbers,
        projectNames: selectedProjectNames,
        sows: selectedSows,
        weeks: selectedWeeks,
      }),
    [
      summary,
      selectedClients,
      selectedProjectNumbers,
      selectedProjectNames,
      selectedSows,
      selectedWeeks,
    ],
  )

  // Totales de la TABLA (fila-cabecera de cliente y fila Total): Consumed/Overage
  // se suman sobre las SEMANAS VISIBLES, así que cuadran con la suma de las celdas
  // mostradas incluso con el filtro Week activo. La tabla no muestra Cumulative/
  // Remaining en estas filas. hasBudget distingue "budget real 0" de "sin budget".
  const clientTotals = useMemo(() => {
    const map = new Map()
    for (const group of clients) {
      const t = { budget: 0, consumed: 0, overage: 0, hasBudget: false }
      for (const p of group.projects) {
        if (p.budget != null) {
          t.budget += p.budget
          t.hasBudget = true
        }
        for (const w of p.weeks) {
          t.consumed += w.consumed
          t.overage += w.overage
        }
      }
      map.set(group.client, t)
    }
    return map
  }, [clients])

  const totals = useMemo(() => {
    const t = { budget: 0, consumed: 0, overage: 0, hasBudget: false }
    for (const g of clientTotals.values()) {
      t.budget += g.budget
      t.consumed += g.consumed
      t.overage += g.overage
      if (g.hasBudget) t.hasBudget = true
    }
    return t
  }, [clientTotals])

  // Totales de los GRÁFICOS: son una foto de estado de budget, así que usan las
  // horas ALL-TIME de cada proyecto (project.consumed/overage del motor) y NO se
  // recortan por el filtro Week (que solo achica filas de la tabla). El scope son
  // los filtros de PROYECTO (Client/Project#/Name/SOW). remaining se acumula por
  // proyecto (max(0, budget − consumido all-time)) para no netear entre proyectos.
  const chartTotals = useMemo(() => {
    const scope = filterClientSummary(summary.clients, {
      clients: selectedClients,
      projectNumbers: selectedProjectNumbers,
      projectNames: selectedProjectNames,
      sows: selectedSows,
    })
    const t = { budget: 0, consumed: 0, overage: 0, remaining: 0, hasBudget: false }
    for (const group of scope) {
      for (const p of group.projects) {
        t.consumed += p.consumed
        t.overage += p.overage
        if (p.budget != null) {
          t.budget += p.budget
          t.hasBudget = true
          t.remaining += Math.max(0, p.budget - p.consumed)
        }
      }
    }
    return t
  }, [summary, selectedClients, selectedProjectNumbers, selectedProjectNames, selectedSows])

  function toggleIn(setter, value) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
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
          rows.push({ ...base, week: '', budget: num1(project.budget ?? ''), consumed: 0, cumulative: 0, remaining: num1(project.budget ?? ''), overage: 0 })
          continue
        }
        project.weeks.forEach((week, i) => {
          rows.push({
            ...base,
            week: weekLabel(week),
            budget: i === 0 ? num1(project.budget ?? '') : '',
            consumed: num1(week.consumed),
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
          requests); Consumed counts bill-to-client hours only, and Overage sits in its own column.
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
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
                          <td className="col-num cell-mono">{ct.hasBudget ? formatHours(ct.budget) : '—'}</td>
                          <td className="col-num cell-mono">{formatHours(ct.consumed)}</td>
                          <td className="col-num" />
                          <td className="col-num" />
                          <td className="col-num cell-mono">{formatHours(ct.overage)}</td>
                        </tr>
                        {group.projects.map((project) => {
                          // Un proyecto sin semanas con horas igual aparece, con una
                          // fila de placeholders (Week '—', consumido 0).
                          const weekRows = project.weeks.length ? project.weeks : [null]
                          return weekRows.map((week, wi) => (
                            <tr key={`${project.id}-${week ? week.weekStart : 'none'}`}>
                              <td />
                              {/* La identidad del proyecto se repite en cada fila-semana
                                  (fiel al ejemplo del doc); el Budget, en cambio, va solo
                                  en la 1ª fila (igual que el export) para que sumar la
                                  columna no lo cuente ×nº-semanas. */}
                              <td className="cell-mono">{project.projectNumber || '—'}</td>
                              <td>{project.projectName || '—'}</td>
                              <td className="cell-soft">{project.sowNumber || '—'}</td>
                              <td className="cell-mono">{week ? weekLabel(week) : '—'}</td>
                              <td className="cell-soft">{project.zohoStatus || '—'}</td>
                              <td className="col-num cell-mono">{wi === 0 ? hoursOrDash(project.budget) : ''}</td>
                              <td className="col-num cell-mono">{formatHours(week ? week.consumed : 0)}</td>
                              <td className="col-num cell-mono">{formatHours(week ? week.cumulative : 0)}</td>
                              <td className="col-num cell-mono">
                                {week ? hoursOrDash(week.remaining) : hoursOrDash(project.budget)}
                              </td>
                              <td className="col-num cell-mono">{formatHours(week ? week.overage : 0)}</td>
                            </tr>
                          ))
                        })}
                      </Fragment>
                    )
                  })}
                  <tr className="summary-row--total">
                    <th scope="row">Total portfolio</th>
                    <td colSpan={5} />
                    <td className="col-num cell-mono">{totals.hasBudget ? formatHours(totals.budget) : '—'}</td>
                    <td className="col-num cell-mono">{formatHours(totals.consumed)}</td>
                    <td className="col-num" />
                    <td className="col-num" />
                    <td className="col-num cell-mono">{formatHours(totals.overage)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {clients.length > 0 && <ClientSummaryCharts totals={chartTotals} />}
        </motion.div>
      )}
    </>
  )
}
