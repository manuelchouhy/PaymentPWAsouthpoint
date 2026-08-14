import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { effectiveBudgetHours } from '../lib/changeRequestsData'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'

const UNASSIGNED = 'Without client'

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

export function ClientSummaryPage() {
  const { user } = useOutletContext()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [crsByProject, setCrsByProject] = useState(() => new Map())
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedClients, setSelectedClients] = useState([])

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

  // Horas por proyecto, separadas por allocation. Consumed son SOLO las
  // bill_to_client: el overage se muestra al lado y nunca se resta ni se suma
  // acá — es justamente la plata que todavía no está decidida quién paga.
  const hoursByProject = useMemo(() => {
    const map = new Map()
    for (const entry of entries) {
      // Sólo aprobadas, igual que Billing y que getConsumedHoursByProject: una
      // hora rechazada no se le imputa al presupuesto del cliente. Entries deja
      // clasificar rechazadas, así que sin este filtro un triage masivo infla
      // el consumido contra el budget.
      if (entry.status !== 'Approved') continue
      if (entry.allocation !== 'bill_to_client' && entry.allocation !== 'overage') continue
      const key = entry.project ?? ''
      const acc = map.get(key) ?? { consumed: 0, overage: 0 }
      const hours = Number(entry.hours) || 0
      if (entry.allocation === 'bill_to_client') acc.consumed += hours
      else acc.overage += hours
      map.set(key, acc)
    }
    return map
  }, [entries])

  const clientOptions = useMemo(
    () => sortedUnique(projects.map((p) => p.customerName || UNASSIGNED)),
    [projects],
  )

  const groups = useMemo(() => {
    const byClient = new Map()
    for (const project of projects) {
      const client = project.customerName || UNASSIGNED
      if (selectedClients.length && !selectedClients.includes(client)) continue
      const hours = hoursByProject.get(project.projectName) ?? { consumed: 0, overage: 0 }
      const budget = effectiveBudgetHours(
        project.baseBudgetHours,
        crsByProject.get(String(project.id)) ?? [],
      )
      const row = {
        id: project.id,
        projectName: project.projectName,
        sowNumber: project.sowNumber,
        zohoStatus: project.zohoStatus,
        // El cliente tal como lo escriben las entries, para poder linkear.
        entryClient: project.client ?? '',
        budget,
        consumed: hours.consumed,
        overage: hours.overage,
      }
      const group = byClient.get(client)
      if (group) group.rows.push(row)
      else byClient.set(client, { client, rows: [row] })
    }

    const list = [...byClient.values()].sort((a, b) => a.client.localeCompare(b.client, 'es'))
    for (const group of list) {
      group.rows.sort((a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? '', 'es'))
      // Un mismo cliente comercial puede agrupar varios nombres de Zoho.
      group.entryClients = [...new Set(group.rows.map((r) => r.entryClient).filter(Boolean))]
      group.consumed = group.rows.reduce((sum, r) => sum + r.consumed, 0)
      group.overage = group.rows.reduce((sum, r) => sum + r.overage, 0)
      // El budget del cliente suma sólo proyectos que tienen presupuesto
      // cargado: contar null como 0 haría ver "consumido > presupuesto" en un
      // proyecto al que simplemente nunca se le cargó el número.
      group.budget = group.rows.reduce((sum, r) => sum + (r.budget ?? 0), 0)
    }
    return list
  }, [projects, selectedClients, hoursByProject, crsByProject])

  const totals = useMemo(
    () => ({
      consumed: groups.reduce((sum, g) => sum + g.consumed, 0),
      overage: groups.reduce((sum, g) => sum + g.overage, 0),
      budget: groups.reduce((sum, g) => sum + g.budget, 0),
    }),
    [groups],
  )

  function toggleClient(value) {
    setSelectedClients((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  // OJO: el filtro de Entries corre sobre `entry.client`, que se corresponde con
  // `projects.client` (el texto que viene de Zoho, "HSS"), NO con
  // `customerName` ("Health Systems Solutions"), que es el nombre comercial con
  // el que se agrupa en pantalla. Mandar el nombre de agrupación llevaría a
  // Entries con el dropdown puesto y cero filas.
  function goToEntries({ entryClients, project }) {
    const params = new URLSearchParams()
    for (const value of new Set((entryClients ?? []).filter(Boolean))) {
      params.append('client', value)
    }
    if (project) params.append('project', project)
    navigate(`/entries?${params.toString()}`)
  }

  function handleExport(format) {
    const cols = [
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'project' },
      { header: 'SOW', key: 'sow' },
      { header: 'Status', key: 'status' },
      { header: 'Consumed', key: 'consumed' },
      { header: 'Budget', key: 'budget' },
      { header: 'Overage', key: 'overage' },
    ]
    const rows = groups.flatMap((group) =>
      group.rows.map((row) => ({
        client: group.client,
        project: row.projectName ?? '',
        sow: row.sowNumber ?? '',
        status: row.zohoStatus ?? '',
        consumed: row.consumed,
        budget: row.budget ?? '',
        overage: row.overage,
      })),
    )
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
          Consumed counts bill-to-client hours only. Overage sits in its own column — it is never
          netted against what the client agreed to pay.
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
                onToggle={toggleClient}
              />
              {selectedClients.length > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost filterbar__clear"
                  onClick={() => setSelectedClients([])}
                >
                  Clear
                </button>
              )}
            </div>
          </section>

          <div className="toolbar">
            <span className="toolbar__count">
              {groups.length} {groups.length === 1 ? 'client' : 'clients'}
            </span>
            {groups.length > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {groups.length === 0 ? (
            <div className="empty">No projects to summarise.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Client / Project</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="col-num">Consumed</th>
                    <th scope="col" className="col-num">Budget</th>
                    <th scope="col" className="col-num">Overage</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.client}>
                      <tr className="summary-row--client">
                        <th scope="rowgroup">
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => goToEntries({ entryClients: group.entryClients })}
                          >
                            {group.client}
                          </button>
                        </th>
                        <td />
                        <td className="col-num cell-mono">{formatHours(group.consumed)}</td>
                        <td className="col-num cell-mono">
                          {group.budget ? formatHours(group.budget) : '—'}
                        </td>
                        <td className="col-num cell-mono">
                          {group.overage ? formatHours(group.overage) : '0.0'}
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.id}>
                          <td style={{ paddingLeft: 26 }}>
                            <button
                              type="button"
                              className="linklike"
                              onClick={() =>
                                goToEntries({
                                  entryClients: [row.entryClient],
                                  project: row.projectName,
                                })
                              }
                            >
                              {row.projectName || '—'}
                              {row.sowNumber && <span className="cell-soft"> · {row.sowNumber}</span>}
                            </button>
                          </td>
                          <td className="cell-soft">{row.zohoStatus || '—'}</td>
                          <td className="col-num cell-mono">{formatHours(row.consumed)}</td>
                          <td className="col-num cell-mono">
                            {row.budget == null ? '—' : formatHours(row.budget)}
                          </td>
                          <td className="col-num cell-mono">
                            {row.overage ? formatHours(row.overage) : '0.0'}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="summary-row--total">
                    <th scope="row">Total portfolio</th>
                    <td />
                    <td className="col-num cell-mono">{formatHours(totals.consumed)}</td>
                    <td className="col-num cell-mono">
                      {totals.budget ? formatHours(totals.budget) : '—'}
                    </td>
                    <td className="col-num cell-mono">{formatHours(totals.overage)}</td>
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
