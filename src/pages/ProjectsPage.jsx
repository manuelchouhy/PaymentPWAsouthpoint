import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Plus } from 'lucide-react'
import {
  CONTRACT_STATUSES,
  contractStatus,
  countByStatus,
  daysRemaining,
} from '../lib/projectsData'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { ContractBadge } from '../components/ContractBadge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ProjectFormModal } from '../components/ProjectFormModal'
import { ProjectWizardModal } from '../components/ProjectWizardModal'
import { ProjectDetailDrawer } from '../components/ProjectDetailDrawer'
import { Toast } from '../components/Toast'
import { ExportDropdown } from '../components/ExportDropdown'
import { exportGrid } from '../lib/exportGrid'

// Ordena por vencimiento ascendente; los proyectos sin fecha de contrato
// (recién traídos de Zoho) van al final.
const sortByExp = (list) =>
  [...list].sort((a, b) =>
    (a.contractExpirationDate || '9999-99-99').localeCompare(
      b.contractExpirationDate || '9999-99-99',
    ),
  )

export function ProjectsPage() {
  const { user, profile, can } = useOutletContext()
  const [projects, setProjects] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState({
    clients: [],
    leadDevelopers: [],
    expFrom: '',
    expTo: '',
  })
  const [statusFilter, setStatusFilter] = useState(null) // null | 'Expired' | …
  const [form, setForm] = useState(null) // null | { mode:'edit', project }
  const [wizardOpen, setWizardOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    api.projects.list()
      .then((data) => {
        if (cancelled) return
        setProjects(data)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar los proyectos:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clientOptions = useMemo(
    () => [...new Set(projects.map((p) => p.client).filter(Boolean))].sort(),
    [projects],
  )
  const leadDevOptions = useMemo(
    () => [...new Set(projects.map((p) => p.leadDeveloper).filter(Boolean))].sort(),
    [projects],
  )

  const statusCounts = useMemo(() => countByStatus(projects), [projects])

  const visible = useMemo(() => {
    const filtered = projects.filter((p) => {
      if (filters.clients.length && !filters.clients.includes(p.client)) return false
      if (
        filters.leadDevelopers.length &&
        !filters.leadDevelopers.includes(p.leadDeveloper)
      )
        return false
      if (filters.expFrom && p.contractExpirationDate < filters.expFrom) return false
      if (filters.expTo && p.contractExpirationDate > filters.expTo) return false
      if (
        statusFilter &&
        contractStatus(daysRemaining(p.contractExpirationDate)) !== statusFilter
      )
        return false
      return true
    })
    return sortByExp(filtered)
  }, [projects, filters, statusFilter])

  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))

  const filtersActive =
    filters.clients.length ||
    filters.leadDevelopers.length ||
    filters.expFrom ||
    filters.expTo

  function handleExport(format) {
    const cols = [
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'projectName' },
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Contract #', key: 'contractNumber' },
      { header: 'Lead Dev', key: 'leadDeveloper' },
      { header: 'Approver', key: 'approver' },
      { header: 'Contract Expiration', key: 'contractExpirationDate' },
      { header: 'Status', key: 'contractStatus' },
      { header: 'Days Left', key: 'daysLeft' },
    ]
    const exportRows = visible.map((p) => ({
      ...p,
      contractStatus: contractStatus(daysRemaining(p.contractExpirationDate)),
      daysLeft: daysRemaining(p.contractExpirationDate),
    }))
    exportGrid({ rows: exportRows, columns: cols, title: 'Projects and SOW', gridName: 'projects', format, generatedBy: user?.email ?? '' })
  }

  /**
   * Alta desde el wizard de Projects and SOW: sube el/los SOW (uno por
   * stage si hasStages, uno solo si no), crea el proyecto, versiona
   * cada documento y crea las tasks del SOW.
   */
  async function handleCreateFromWizard(payload) {
    const { stages, tasks, sowFile, ...projectFields } = payload
    const uploadedBy = user?.email ?? null

    const sowUrl = payload.hasStages ? null : await api.projects.uploadSowFile(sowFile)
    const created = await api.projects.create({ ...projectFields, sowUrl }, uploadedBy)

    if (!payload.hasStages && sowUrl) {
      await api.projects.recordDocument({
        subjectType: 'sow',
        subjectId: created.id,
        fileUrl: sowUrl,
        uploadedBy,
      })
    }

    if (payload.hasStages && stages?.length) {
      const stagesWithUrls = []
      for (const stage of stages) {
        const stageUrl = await api.projects.uploadSowFile(stage.sowFile)
        stagesWithUrls.push({ stageName: stage.stageName, sowNumber: stage.sowNumber, sowUrl: stageUrl })
      }
      const createdStages = await api.projects.createStages(created.id, stagesWithUrls, uploadedBy)
      await Promise.all(
        createdStages.map((stage, i) =>
          api.projects.recordDocument({
            subjectType: 'sow',
            subjectId: stage.id,
            fileUrl: stagesWithUrls[i].sowUrl,
            uploadedBy,
          }),
        ),
      )
    }

    if (tasks?.length) {
      await api.projectTasks.create(created.id, tasks, uploadedBy)
    }

    api.audit.log({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'project.create',
      resourceType: 'project',
      resourceId: created.id,
      after: { projectNumber: created.projectNumber, projectName: created.projectName, client: created.client },
    })
    setProjects((prev) => sortByExp([created, ...prev]))
    setWizardOpen(false)
    setToast({ id: Date.now(), message: `Project created: ${created.projectName}` })
  }

  async function handleUpdate(payload) {
    const updated = await api.projects.update(form.project, payload, user?.email ?? null)
    api.audit.log({ actorEmail: user?.email, actorRole: profile?.roles?.[0] ?? null, action: 'project.update', resourceType: 'project', resourceId: updated.id, before: { projectNumber: form.project.projectNumber }, after: { projectNumber: updated.projectNumber, projectName: updated.projectName, client: updated.client } })
    setProjects((prev) => sortByExp(prev.map((p) => (p.id === updated.id ? updated : p))))
    setForm(null)
    setToast({ id: Date.now(), message: `Project updated: ${updated.projectNumber}` })
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
          <span className="masthead__kicker">Client contract management</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Projects and SOW</h1>
        <p className="masthead__sub">
          Master list of projects and their SOWs, with client, budget hours and
          scope.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading projects…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load projects</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="proj-kpis">
            <div className="proj-kpis__chips" role="group" aria-label="Contracts by status">
              {CONTRACT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`proj-kpi proj-kpi--${s.toLowerCase().replace(/ /g, '-')}${
                    statusFilter === s ? ' is-active' : ''
                  }`}
                  onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
                  aria-pressed={statusFilter === s}
                >
                  <span className="proj-kpi__count">{statusCounts[s]}</span>
                  <span className="proj-kpi__label">{s}</span>
                </button>
              ))}
            </div>
            {can('settings.view') && (
              <Link to="/contract-alerts" className="btn btn--ghost proj-alerts-link">
                <BellRing size={15} aria-hidden="true" />
                Alert settings
              </Link>
            )}
          </div>

          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
              {can('projects.create') && (
                <button
                  type="button"
                  className="btn btn--pay proj-new-btn"
                  onClick={() => setWizardOpen(true)}
                >
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                  New Project
                </button>
              )}
            </div>
            <div className="filterbar__controls">
              <MultiSelectDropdown
                label="Client"
                options={clientOptions}
                selected={filters.clients}
                onToggle={(v) => toggle('clients', v)}
              />
              <MultiSelectDropdown
                label="Lead Developer"
                options={leadDevOptions}
                selected={filters.leadDevelopers}
                onToggle={(v) => toggle('leadDevelopers', v)}
              />
              <div className="filterfield">
                <span className="filterfield__label">Due from</span>
                <input
                  type="date"
                  className="filterfield__input"
                  value={filters.expFrom}
                  max={filters.expTo || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, expFrom: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Due to</span>
                <input
                  type="date"
                  className="filterfield__input"
                  value={filters.expTo}
                  min={filters.expFrom || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, expTo: e.target.value }))}
                />
              </div>
              {filtersActive ? (
                <button
                  type="button"
                  className="btn btn--ghost filterbar__clear"
                  onClick={() =>
                    setFilters({ clients: [], leadDevelopers: [], expFrom: '', expTo: '' })
                  }
                >
                  Clear
                </button>
              ) : null}
            </div>
          </section>

          <div className="toolbar">
            <ExportDropdown onExport={handleExport} />
            <span className="toolbar__count">
              {visible.length} {visible.length === 1 ? 'project' : 'projects'}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">No projects to display.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Project Name</th>
                    <th scope="col">Project #</th>
                    <th scope="col">Zoho Status</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Code</th>
                    <th scope="col">Proposal</th>
                    <th scope="col">Proposal #</th>
                    <th scope="col">Approver</th>
                    <th scope="col">Cust. Manager</th>
                    <th scope="col">Lead Dev</th>
                    <th scope="col">Contract #</th>
                    <th scope="col">Expiration</th>
                    <th scope="col" className="col-num">Days</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p, index) => {
                    const days = daysRemaining(p.contractExpirationDate)
                    const st = contractStatus(days)
                    return (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
                        onClick={() => setDetail(p)}
                        title={`View ${p.projectName}`}
                      >
                        <td>{p.client}</td>
                        <td className="cell-strong">{p.projectName}</td>
                        <td className="cell-mono">{p.projectNumber}</td>
                        <td>
                          {p.zohoStatus ? (
                            <span className="zoho-status">{p.zohoStatus}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="cell-soft">{p.customerName || '—'}</td>
                        <td className="cell-mono">{p.customerCode || '—'}</td>
                        <td className="cell-soft">{p.proposalName || '—'}</td>
                        <td className="cell-mono">{p.proposalNumber || '—'}</td>
                        <td>{p.approver || '—'}</td>
                        <td>{p.customerManager || '—'}</td>
                        <td>{p.leadDeveloper || '—'}</td>
                        <td className="cell-mono">{p.contractNumber || '—'}</td>
                        <td className="cell-mono">
                          {p.contractExpirationDate
                            ? formatDate(p.contractExpirationDate)
                            : '—'}
                        </td>
                        <td
                          className={`col-num cell-mono${days != null && days < 0 ? ' proj-days--overdue' : ''}`}
                        >
                          {days == null ? '—' : days}
                        </td>
                        <td>
                          <ContractBadge status={st} />
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {form && (
          <ProjectFormModal
            key={`edit-${form.project.id}`}
            initial={form.project}
            onClose={() => setForm(null)}
            onSubmit={handleUpdate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wizardOpen && (
          <ProjectWizardModal
            key="project-wizard"
            onClose={() => setWizardOpen(false)}
            onSubmit={handleCreateFromWizard}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <ProjectDetailDrawer
            key={`detail-${detail.id}`}
            project={detail}
            onClose={() => setDetail(null)}
            onEdit={() => {
              const project = detail
              setDetail(null)
              setForm({ mode: 'edit', project })
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
