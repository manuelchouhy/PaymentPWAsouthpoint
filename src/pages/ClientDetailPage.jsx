import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours, isoWeek } from '../lib/format'

const VIEWS = [
  { id: 'line', label: 'Line' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const UNMAPPED = 'Unassigned business line'
const MONTHS_SHOWN = 3

const monthKey = (iso) => (iso ? iso.slice(0, 7) : '')

function monthLabel(key) {
  if (!key) return '—'
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Los N meses que terminan en el seleccionado, más viejo primero.
function lastMonths(endKey, count) {
  if (!endKey) return []
  const [year, month] = endKey.split('-').map(Number)
  const keys = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function ClientDetailPage() {
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const [client, setClient] = useState('')
  const [projectId, setProjectId] = useState('')
  const [period, setPeriod] = useState('')
  const [view, setView] = useState('line')
  const [showBackup, setShowBackup] = useState(false)
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([api.projects.list(), api.timeEntries.list()])
      .then(([projectRows, entryRows]) => {
        if (cancelled) return
        setProjects(projectRows)
        setEntries(entryRows)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Client Detail:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const clients = useMemo(
    () =>
      [...new Set(projects.map((p) => p.customerName).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
    [projects],
  )

  // El SOW se elige dentro del cliente: ofrecer los de otro cliente sería
  // ofrecer un cruce que no existe.
  const clientProjects = useMemo(
    () => projects.filter((p) => (p.customerName || '') === client),
    [projects, client],
  )

  const project = clientProjects.find((p) => String(p.id) === String(projectId)) ?? null

  useEffect(() => {
    // Al cambiar de cliente, el SOW anterior ya no aplica.
    setProjectId('')
    setTasks([])
  }, [client])

  useEffect(() => {
    if (!project) {
      setTasks([])
      return
    }
    let cancelled = false
    api.projectTasks
      .list(project.id)
      .then((rows) => {
        if (!cancelled) setTasks(rows)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar las tasks del SOW:', error)
        setTasks([])
      })
    return () => {
      cancelled = true
    }
  }, [project])

  // task → business line. La línea de negocio es el `role` de la task del SOW:
  // es lo que el cliente reconoce ("Backend Development"), no el nombre de la
  // persona ni el número de task.
  const lineByTask = useMemo(() => {
    const map = new Map()
    for (const task of tasks) map.set(task.taskName, task.role || UNMAPPED)
    return map
  }, [tasks])

  // Sólo horas aprobadas y facturables al cliente. Overage sin CR aprobado,
  // SP internal y rechazadas quedan afuera: esta vista es lo que se le puede
  // mostrar al cliente, no la contabilidad interna.
  const scoped = useMemo(() => {
    if (!project) return []
    return entries.filter(
      (e) =>
        e.status === 'Approved' &&
        e.allocation === 'bill_to_client' &&
        e.project === project.projectName,
    )
  }, [entries, project])

  const periods = useMemo(() => {
    const keys = [...new Set(scoped.map((e) => monthKey(e.date)).filter(Boolean))]
    return keys.sort().reverse()
  }, [scoped])

  useEffect(() => {
    // Se sigue el dato: por defecto, el mes más reciente que tenga horas.
    setPeriod(periods[0] ?? '')
  }, [periods])

  const inPeriod = useMemo(
    () => (period ? scoped.filter((e) => monthKey(e.date) === period) : scoped),
    [scoped, period],
  )

  const lineRows = useMemo(() => {
    const map = new Map()
    for (const entry of inPeriod) {
      const line = lineByTask.get(entry.task) ?? UNMAPPED
      map.set(line, (map.get(line) ?? 0) + (Number(entry.hours) || 0))
    }
    return [...map.entries()]
      .map(([line, hours]) => ({ line, hours }))
      .sort((a, b) => b.hours - a.hours)
  }, [inPeriod, lineByTask])

  const weekView = useMemo(() => {
    // Las semanas se ordenan por la fecha más temprana que contienen, no por su
    // número: enero arrastra días de la W52/W53 del año anterior, y ordenar por
    // número dejaría esa semana —la primera cronológicamente— al final.
    const weekFirstDate = new Map()
    const map = new Map()
    for (const entry of inPeriod) {
      const week = isoWeek(entry.date)
      if (week == null) continue
      const earliest = weekFirstDate.get(week)
      if (!earliest || entry.date < earliest) weekFirstDate.set(week, entry.date)
      const line = lineByTask.get(entry.task) ?? UNMAPPED
      const row = map.get(line) ?? new Map()
      row.set(week, (row.get(week) ?? 0) + (Number(entry.hours) || 0))
      map.set(line, row)
    }
    const weekList = [...weekFirstDate.keys()].sort((a, b) =>
      weekFirstDate.get(a).localeCompare(weekFirstDate.get(b)),
    )
    const rows = [...map.entries()]
      .map(([line, byWeek]) => ({
        line,
        cells: weekList.map((w) => byWeek.get(w) ?? 0),
        total: [...byWeek.values()].reduce((sum, h) => sum + h, 0),
      }))
      .sort((a, b) => b.total - a.total)
    return { columns: weekList.map((w) => `W${w}`), rows }
  }, [inPeriod, lineByTask])

  const monthView = useMemo(() => {
    const months = lastMonths(period, MONTHS_SHOWN)
    const monthSet = new Set(months)
    const map = new Map()
    for (const entry of scoped) {
      const key = monthKey(entry.date)
      if (!monthSet.has(key)) continue
      const line = lineByTask.get(entry.task) ?? UNMAPPED
      const row = map.get(line) ?? new Map()
      row.set(key, (row.get(key) ?? 0) + (Number(entry.hours) || 0))
      map.set(line, row)
    }
    const rows = [...map.entries()]
      .map(([line, byMonth]) => ({
        line,
        cells: months.map((m) => byMonth.get(m) ?? 0),
        total: months.reduce((sum, m) => sum + (byMonth.get(m) ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total)
    return { columns: months.map(monthLabel), rows }
  }, [scoped, period, lineByTask])

  // Respaldo anónimo: agrupa por línea y task, NUNCA por persona. El nombre del
  // proveedor no entra en esta pantalla ni siquiera para ordenar.
  const backupRows = useMemo(() => {
    const map = new Map()
    for (const entry of inPeriod) {
      const line = lineByTask.get(entry.task) ?? UNMAPPED
      const week = isoWeek(entry.date)
      const key = `${line}||${entry.task ?? ''}||${week ?? ''}`
      const row = map.get(key) ?? { line, task: entry.task ?? '—', week, hours: 0 }
      row.hours += Number(entry.hours) || 0
      map.set(key, row)
    }
    return [...map.values()].sort(
      (a, b) => a.line.localeCompare(b.line, 'es') || (a.week ?? 0) - (b.week ?? 0),
    )
  }, [inPeriod, lineByTask])

  const totalHours = lineRows.reduce((sum, r) => sum + r.hours, 0)

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">Client Detail</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Client Detail</h1>
        <p className="masthead__sub">
          Internal on-screen view. Bill-to-client approved hours only — no costs, no provider
          names, and nothing to export from here.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading client detail…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load client detail</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <section className="cap-panel" aria-label="Report scope">
            <div className="cd-config">
              <div className="field">
                <label className="field__label" htmlFor="cd-client">Client</label>
                <select
                  id="cd-client"
                  className="field__input"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                >
                  <option value="">Select a client…</option>
                  {clients.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cd-sow">SOW</label>
                <select
                  id="cd-sow"
                  className="field__input"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={!client}
                >
                  <option value="">{client ? 'Select a SOW…' : 'Pick a client first'}</option>
                  {clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sowNumber ? `${p.sowNumber} · ` : ''}{p.projectName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cd-period">Period</label>
                <select
                  id="cd-period"
                  className="field__input"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  disabled={periods.length === 0}
                >
                  {periods.length === 0 && <option value="">No hours yet</option>}
                  {periods.map((key) => (
                    <option key={key} value={key}>{monthLabel(key)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span className="field__label">Granularity</span>
                <div className="cd-tabs" role="tablist" aria-label="Granularity">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={view === v.id}
                      className={`cd-tab${view === v.id ? ' is-active' : ''}`}
                      onClick={() => setView(v.id)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className="cd-backup-toggle">
              <input
                type="checkbox"
                checked={showBackup}
                onChange={(e) => setShowBackup(e.target.checked)}
              />
              Show anonymous hour backup (business line and task only — never a name)
            </label>
          </section>

          {!project ? (
            <div className="empty">Pick a client and a SOW to see the detail.</div>
          ) : lineRows.length === 0 ? (
            <div className="empty">
              No bill-to-client approved hours for this SOW in the selected period.
            </div>
          ) : (
            <>
              {view === 'line' && (
                <div className="table-wrap table-wrap--scroll">
                  <table className="table proj-table">
                    <thead>
                      <tr>
                        <th scope="col">Business line</th>
                        <th scope="col" className="col-num">Bill-to-client hours</th>
                        <th scope="col" className="col-num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineRows.map((row) => (
                        <tr key={row.line}>
                          <td className="cell-strong">{row.line}</td>
                          <td className="col-num cell-mono">{formatHours(row.hours)}</td>
                          <td className="col-num cell-soft">← billing system</td>
                        </tr>
                      ))}
                      <tr className="summary-row--total">
                        <th scope="row">Total</th>
                        <td className="col-num cell-mono">{formatHours(totalHours)}</td>
                        <td className="col-num cell-soft">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {(view === 'week' || view === 'month') && (
                <MatrixTable data={view === 'week' ? weekView : monthView} />
              )}

              {showBackup && (
                <div className="table-wrap table-wrap--scroll" style={{ marginTop: 16 }}>
                  <table className="table proj-table">
                    <thead>
                      <tr>
                        <th scope="col">Business line</th>
                        <th scope="col">Task</th>
                        <th scope="col">Week</th>
                        <th scope="col" className="col-num">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backupRows.map((row) => (
                        <tr key={`${row.line}-${row.task}-${row.week}`}>
                          <td>{row.line}</td>
                          <td className="cell-soft">{row.task}</td>
                          <td className="cell-mono">{row.week ? `W${row.week}` : '—'}</td>
                          <td className="col-num cell-mono">{formatHours(row.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </>
  )
}

function MatrixTable({ data }) {
  if (data.columns.length === 0) {
    return <div className="empty">No hours in this breakdown.</div>
  }
  return (
    <div className="table-wrap table-wrap--scroll">
      <table className="table proj-table">
        <thead>
          <tr>
            <th scope="col">Business line</th>
            {data.columns.map((col) => (
              <th key={col} scope="col" className="col-num">{col}</th>
            ))}
            <th scope="col" className="col-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.line}>
              <td className="cell-strong">{row.line}</td>
              {row.cells.map((value, i) => (
                <td key={data.columns[i]} className="col-num cell-mono">
                  {value ? formatHours(value) : '—'}
                </td>
              ))}
              <td className="col-num cell-mono">{formatHours(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
