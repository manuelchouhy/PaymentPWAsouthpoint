import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { effectiveBudgetHours } from '../lib/changeRequestsData'
import { displaySupplierStatus } from '../lib/supplierContractsData'
import { ExportDropdown } from '../components/ExportDropdown'

// Ventana para medir el uso real. 4 semanas: menos que eso y una semana de
// licencia mueve el promedio; más, y deja de reflejar el ritmo actual.
const USAGE_WEEKS = 4
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

// Un contrato vencido o archivado no aporta capacidad, pero el proveedor sigue
// apareciendo en la tabla: si cargó horas esta semana con el contrato vencido,
// esconderlo es esconder el problema.
//
// El vencimiento se DERIVA de expirationDate, no se lee de la columna `status`:
// nada en la app escribe 'Expired' ahí (el flujo de renovación sólo escribe
// 'Active' y 'Renewal in Progress'), así que confiar en la columna dejaría
// contratos vencidos sumando capacidad. Es la misma razón por la que
// SupplierContractsPage usa displaySupplierStatus.
const isActiveContract = (c) => !c.archived && displaySupplierStatus(c) !== 'Expired'

function weeksBetween(fromISO, toDate) {
  const from = new Date(`${fromISO}T00:00:00Z`)
  if (Number.isNaN(from.getTime())) return null
  return (from.getTime() - toDate.getTime()) / MS_PER_WEEK
}

export function CapacityPage() {
  const { user } = useOutletContext()
  const [contracts, setContracts] = useState([])
  const [entries, setEntries] = useState([])
  const [projects, setProjects] = useState([])
  const [crsByProject, setCrsByProject] = useState(() => new Map())
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([
      api.supplierContracts.list(),
      api.timeEntries.list(),
      api.projects.list(),
      api.changeRequests.listByProject(),
    ])
      .then(([contractRows, entryRows, projectRows, crMap]) => {
        if (cancelled) return
        setContracts(contractRows)
        setEntries(entryRows)
        setProjects(projectRows)
        setCrsByProject(crMap)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Capacity:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Uso = promedio de horas/semana de las últimas 4 semanas. Se cuentan todas
  // las horas aprobadas, no sólo las facturables: la capacidad de un proveedor
  // se gasta igual haya sido overage o interna.
  const usageByProvider = useMemo(() => {
    const cutoff = new Date(Date.now() - USAGE_WEEKS * MS_PER_WEEK)
    const map = new Map()
    for (const entry of entries) {
      if (entry.status !== 'Approved' || !entry.date) continue
      if (new Date(`${entry.date}T00:00:00Z`) < cutoff) continue
      const hours = Number(entry.hours) || 0
      map.set(entry.user, (map.get(entry.user) ?? 0) + hours)
    }
    for (const [provider, total] of map) map.set(provider, total / USAGE_WEEKS)
    return map
  }, [entries])

  const providerRows = useMemo(() => {
    const byProvider = new Map()
    for (const contract of contracts) {
      const active = isActiveContract(contract)
      const row = byProvider.get(contract.supplierName) ?? {
        provider: contract.supplierName,
        contracted: 0,
        hasActiveContract: false,
        hasContract: true,
      }
      if (active && contract.weeklyContractedHours != null) {
        row.contracted += Number(contract.weeklyContractedHours)
      }
      if (active) row.hasActiveContract = true
      byProvider.set(contract.supplierName, row)
    }
    // Alguien puede estar cargando horas sin contrato cargado en el sistema:
    // omitirlo mostraría una capacidad usada menor que la real. Se distingue de
    // "contrato vencido": no tener contrato cargado es una tarea administrativa
    // pendiente, no una alarma de contrato caído.
    for (const provider of usageByProvider.keys()) {
      if (!byProvider.has(provider)) {
        byProvider.set(provider, {
          provider,
          contracted: 0,
          hasActiveContract: false,
          hasContract: false,
        })
      }
    }
    return [...byProvider.values()]
      .map((row) => {
        const usage = usageByProvider.get(row.provider) ?? 0
        const ratio = row.contracted > 0 ? usage / row.contracted : null
        let state = 'ok'
        if (!row.hasContract) state = 'no-contract'
        else if (!row.hasActiveContract) state = 'contract-expired'
        else if (ratio == null) state = 'no-hours-set'
        else if (ratio > 1) state = 'over-contract'
        else if (ratio >= 0.9) state = 'at-limit'
        return { ...row, usage, ratio, state }
      })
      .sort((a, b) => a.provider.localeCompare(b.provider, 'es'))
  }, [contracts, usageByProvider])

  // Demanda: lo que falta consumir de cada SOW activo y a qué ritmo semanal hay
  // que ir para llegar a period_end.
  const demandRows = useMemo(() => {
    const consumedByProject = new Map()
    for (const entry of entries) {
      // Mismo criterio que Client Summary y Billing: rechazadas no consumen
      // presupuesto, así que tampoco reducen la demanda pendiente.
      if (entry.status !== 'Approved') continue
      if (entry.allocation !== 'bill_to_client') continue
      const key = entry.project ?? ''
      consumedByProject.set(key, (consumedByProject.get(key) ?? 0) + (Number(entry.hours) || 0))
    }
    const now = new Date()
    return projects
      // Un SOW archivado no genera demanda: su saldo no hay que ejecutarlo.
      .filter((project) => project.zohoStatus !== 'archived')
      .map((project) => {
        const budget = effectiveBudgetHours(
          project.baseBudgetHours,
          crsByProject.get(String(project.id)) ?? [],
        )
        if (budget == null) return null
        const consumed = consumedByProject.get(project.projectName) ?? 0
        const remaining = Math.max(0, budget - consumed)
        const weeksLeft = project.periodEnd ? weeksBetween(project.periodEnd, now) : null
        // Un SOW vencido no reparte su saldo en semanas negativas: se marca y
        // el ritmo requerido no se calcula, porque ya no hay plazo.
        const overdue = weeksLeft != null && weeksLeft <= 0
        return {
          id: project.id,
          sow: project.sowNumber || project.projectName || '—',
          remaining,
          weeksLeft: overdue ? 0 : weeksLeft,
          // Piso de una semana: un SOW que vence pasado mañana daría "700 h/wk"
          // y, como las tres barras comparten escala, aplastaría el panel
          // entero a una raya. El ritmo sigue siendo enorme, pero legible.
          requiredPace:
            !overdue && weeksLeft && weeksLeft > 0 ? remaining / Math.max(1, weeksLeft) : null,
          overdue,
        }
      })
      .filter((row) => row && row.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)
  }, [projects, entries, crsByProject])

  const totals = useMemo(() => {
    const contracted = providerRows.reduce((sum, r) => sum + r.contracted, 0)
    const usage = providerRows.reduce((sum, r) => sum + r.usage, 0)
    const remainingDemand = demandRows.reduce((sum, r) => sum + r.remaining, 0)
    const requiredPace = demandRows.reduce((sum, r) => sum + (r.requiredPace ?? 0), 0)
    return {
      contracted,
      usage,
      remainingDemand,
      requiredPace,
      // Cobertura = cuánto de la capacidad contratada se está usando. Sin
      // capacidad cargada no es 0%, es "no se sabe".
      coverage: contracted > 0 ? (usage / contracted) * 100 : null,
    }
  }, [providerRows, demandRows])

  // Las tres barras comparten escala: si cada una se normalizara contra sí
  // misma, "100 contratadas" y "25 requeridas" se verían igual de largas.
  const barScale = Math.max(totals.contracted, totals.usage, totals.requiredPace, 1)
  const barWidth = (value) => `${Math.min(100, (value / barScale) * 100)}%`

  function handleExportProviders(format) {
    exportGrid({
      rows: providerRows.map((r) => ({
        provider: r.provider,
        contracted: r.contracted,
        usage: Number(r.usage.toFixed(2)),
        status: PROVIDER_STATE_LABELS[r.state],
      })),
      columns: [
        { header: 'Provider', key: 'provider' },
        { header: 'Contracted (h/wk)', key: 'contracted' },
        { header: 'Usage (h/wk)', key: 'usage' },
        { header: 'Status', key: 'status' },
      ],
      title: 'Capacity by provider',
      gridName: 'capacity-by-provider',
      format,
      generatedBy: user?.email ?? '',
    })
  }

  function handleExportDemand(format) {
    exportGrid({
      rows: demandRows.map((r) => ({
        sow: r.sow,
        remaining: r.remaining,
        weeks: r.weeksLeft == null ? '' : Math.round(r.weeksLeft),
        pace: r.requiredPace == null ? '' : Number(r.requiredPace.toFixed(1)),
      })),
      columns: [
        { header: 'SOW', key: 'sow' },
        { header: 'Remaining hours', key: 'remaining' },
        { header: 'Weeks left', key: 'weeks' },
        { header: 'Required h/wk', key: 'pace' },
      ],
      title: 'Demand by SOW',
      gridName: 'capacity-demand-by-sow',
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
          <span className="masthead__kicker">Capacity</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Capacity</h1>
        <p className="masthead__sub">
          Contracted hours against what is actually being logged, and the pace the open SOWs
          demand. Usage is the average over the last {USAGE_WEEKS} weeks.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading capacity…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load capacity</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <div className="dash-kpis">
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Contracted capacity</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(totals.contracted)}
                <span className="dash-kpi__unit"> h/wk</span>
              </span>
              <span className="dash-kpi__hint">excludes expired and archived contracts</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Current usage</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(totals.usage)}
                <span className="dash-kpi__unit"> h/wk</span>
              </span>
              <span className="dash-kpi__hint">last {USAGE_WEEKS} weeks, approved hours</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Remaining demand</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(totals.remainingDemand)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">unconsumed budget on open SOWs</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Coverage</span>
              </div>
              <span className="dash-kpi__value">
                {totals.coverage == null ? '—' : `${Math.round(totals.coverage)}%`}
              </span>
              <span className="dash-kpi__hint">
                {totals.coverage == null
                  ? 'no contracted hours loaded yet'
                  : 'usage over contracted capacity'}
              </span>
            </div>
          </div>

          <section className="cap-panel">
            <h2 className="cap-panel__title">Weekly balance</h2>
            <div className="capbars">
              {[
                { label: 'Contracted', value: totals.contracted, cls: '' },
                { label: 'Current usage', value: totals.usage, cls: ' capbar__fill--usage' },
                { label: 'Required pace', value: totals.requiredPace, cls: ' capbar__fill--pace' },
              ].map((bar) => (
                <div key={bar.label} className="capbar">
                  <div className="capbar__head">
                    <span>{bar.label}</span>
                    <b>{formatHours(bar.value)} h/wk</b>
                  </div>
                  <div className="capbar__track">
                    <span className={`capbar__fill${bar.cls}`} style={{ width: barWidth(bar.value) }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="cap-grid">
            <section>
              <div className="toolbar">
                <span className="toolbar__count">Capacity by provider</span>
                {providerRows.length > 0 && <ExportDropdown onExport={handleExportProviders} />}
              </div>
              {providerRows.length === 0 ? (
                <div className="empty">No providers to show.</div>
              ) : (
                <div className="table-wrap table-wrap--scroll">
                  <table className="table proj-table">
                    <thead>
                      <tr>
                        <th scope="col">Provider</th>
                        <th scope="col" className="col-num">Contracted</th>
                        <th scope="col" className="col-num">Usage</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerRows.map((row) => (
                        <tr key={row.provider}>
                          <td className="cell-strong">{row.provider}</td>
                          <td className="col-num cell-mono">
                            {row.contracted ? formatHours(row.contracted) : '—'}
                          </td>
                          <td className="col-num cell-mono">{formatHours(row.usage)}</td>
                          <td>
                            <span className={`badge ${PROVIDER_STATE_CLASS[row.state]}`}>
                              {row.ratio != null && `${Math.round(row.ratio * 100)}% · `}
                              {PROVIDER_STATE_LABELS[row.state]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <div className="toolbar">
                <span className="toolbar__count">Demand by SOW</span>
                {demandRows.length > 0 && <ExportDropdown onExport={handleExportDemand} />}
              </div>
              {demandRows.length === 0 ? (
                <div className="empty">No open demand: every SOW with a budget is fully consumed.</div>
              ) : (
                <div className="table-wrap table-wrap--scroll">
                  <table className="table proj-table">
                    <thead>
                      <tr>
                        <th scope="col">SOW</th>
                        <th scope="col" className="col-num">Remaining</th>
                        <th scope="col" className="col-num">Weeks</th>
                        <th scope="col" className="col-num">h/wk req.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demandRows.map((row) => (
                        <tr key={row.id}>
                          <td className="cell-strong">{row.sow}</td>
                          <td className="col-num cell-mono">{formatHours(row.remaining)}</td>
                          <td className="col-num cell-mono">
                            {row.weeksLeft == null ? '—' : Math.round(row.weeksLeft)}
                          </td>
                          <td className="col-num cell-mono">
                            {row.overdue ? 'past due' : row.requiredPace == null ? '—' : formatHours(row.requiredPace)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </motion.div>
      )}
    </>
  )
}

const PROVIDER_STATE_LABELS = {
  ok: 'ok',
  'at-limit': 'at limit',
  'over-contract': 'over contract',
  'contract-expired': 'contract expired',
  'no-contract': 'no contract on file',
  'no-hours-set': 'no hours set',
}

const PROVIDER_STATE_CLASS = {
  ok: 'badge--ok',
  'at-limit': 'badge--pending',
  'over-contract': 'badge--no',
  'contract-expired': 'badge--expired',
  // Falta cargar el contrato, no se cayó: no merece el rojo de "vencido".
  'no-contract': 'badge--pending',
  'no-hours-set': 'badge--pending',
}
