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

  // Nombres de proyecto que realmente figuran en alguna entry — los únicos que
  // Entries ofrece como opción de filtro.
  const projectsWithEntries = useMemo(
    () => new Set(entries.map((e) => e.project).filter(Boolean)),
    [entries],
  )

  // Nombre con el que se agrupa un proyecto. `customerName` es el nombre
  // comercial que trae el sync de Zoho; `client` es lo que escribe el wizard al
  // elegir un cliente de la tabla clients (guarda ademas client_id, pero NO
  // customer_name). Sin este fallback, todo proyecto creado desde el wizard
  // caia en "Without client" aunque tuviera su cliente bien asignado.
  const groupNameOf = (project) => project.customerName || project.client || UNASSIGNED

  const clientOptions = useMemo(() => sortedUnique(projects.map(groupNameOf)), [projects])

  const groups = useMemo(() => {
    const byClient = new Map()
    for (const project of projects) {
      const client = groupNameOf(project)
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
      // Nombres de proyecto del grupo que además aparecen en alguna entry: el
      // dropdown de Project en Entries se arma con los nombres presentes en las
      // entries, así que mandar uno sin horas deja un filtro puesto que no se
      // puede destildar porque no figura en la lista — sólo "Clear" lo saca.
      group.projectNames = [
        ...new Set(group.rows.map((r) => r.projectName).filter((n) => n && projectsWithEntries.has(n))),
      ]
      group.consumed = group.rows.reduce((sum, r) => sum + r.consumed, 0)
      group.overage = group.rows.reduce((sum, r) => sum + r.overage, 0)
      // El budget del cliente suma sólo proyectos que tienen presupuesto
      // cargado: contar null como 0 haría ver "consumido > presupuesto" en un
      // proyecto al que simplemente nunca se le cargó el número.
      group.budget = group.rows.reduce((sum, r) => sum + (r.budget ?? 0), 0)
    }
    return list
  }, [projects, selectedClients, hoursByProject, crsByProject, projectsWithEntries])

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

  // El drill-down filtra por NOMBRE DE PROYECTO, no por cliente, porque es la
  // misma clave con la que se calculó el número clickeado (`hoursByProject` se
  // agrupa por `entry.project`).
  //
  // Filtrar por cliente fallaba en las dos direcciones: de menos, porque un
  // proyecto sin `projects.client` cargado aporta horas al total pero no tiene
  // valor con el cual filtrarlas; y de más, porque dos grupos pueden compartir
  // el mismo `client` de Zoho cuando difieren en `customerName`, y clickear
  // cualquiera traía las horas de ambos.
  //
  // OJO, la grilla de destino NO es igual al número clickeado, y no puede serlo:
  // Entries no filtra por status ni por allocation, así que muestra también las
  // rechazadas y las de overage, que el consumido excluye. Es un "llevame a las
  // horas de este proyecto", no una reconciliación. Tampoco distingue dos
  // proyectos que se llamen igual — limitación de fondo: `hoursByProject` los
  // mete en el mismo balde, así que la fila ya venía sumando las horas de los
  // dos desde antes de este drill-down.
  function goToEntries(projectNames) {
    const params = new URLSearchParams()
    for (const value of new Set((projectNames ?? []).filter(Boolean))) {
      params.append('project', value)
    }
    // Sin filtro que mandar, navegar abriría Entries con TODA la cartera
    // presentada como si fueran las horas de este cliente. Mejor no ofrecer el
    // drill-down (abajo el link no se dibuja) que ofrecer uno que miente.
    if (![...params.keys()].length) return
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
                          {group.projectNames.length ? (
                            <button
                              type="button"
                              className="linklike"
                              onClick={() => goToEntries(group.projectNames)}
                            >
                              {group.client}
                            </button>
                          ) : (
                            // Ningún proyecto del grupo tiene nombre: no hay
                            // filtro posible, así que tampoco link.
                            group.client
                          )}
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
                            {/* Mismo criterio que el link del grupo: un proyecto
                                sin entries deja en Entries un filtro que no
                                figura en el dropdown y sólo sale con "Clear". */}
                            {projectsWithEntries.has(row.projectName) ? (
                              <button
                                type="button"
                                className="linklike"
                                onClick={() => goToEntries([row.projectName])}
                              >
                                {row.projectName || '—'}
                                {row.sowNumber && (
                                  <span className="cell-soft"> · {row.sowNumber}</span>
                                )}
                              </button>
                            ) : (
                              <>
                                {row.projectName || '—'}
                                {row.sowNumber && (
                                  <span className="cell-soft"> · {row.sowNumber}</span>
                                )}
                              </>
                            )}
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
