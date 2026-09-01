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
import { projectSows } from '../lib/projectSows'
import { api } from '../lib/api'
import { buildClientResolver } from '../lib/clientResolver'
import { clientFilterKey, clientFilterOptions } from '../lib/useEntryFilters'
import { formatDate, formatHours } from '../lib/format'
import { ContractBadge } from '../components/ContractBadge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ProjectFormModal } from '../components/ProjectFormModal'
import { ProjectWizardModal } from '../components/ProjectWizardModal'
import { ProjectDetailCarousel } from '../components/ProjectDetailCarousel'
import { Toast } from '../components/Toast'
import { ExportDropdown } from '../components/ExportDropdown'
import { exportGrid } from '../lib/exportGrid'

// El centinela del filtro de Cliente (OTHER_CLIENT) vive en useEntryFilters, la
// misma fuente que usan Entries y Billing: agrupa los proyectos cuyo cliente
// resuelto NO está en el maestro (legacy o sin cliente), que si no quedarían
// fuera de todo filtro. Se agrega al dropdown sólo si existe alguno.

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
  // Maestro de clientes (página Clients): resuelve el cliente de cada proyecto por
  // la cadena grupo→cliente y alimenta el dropdown con TODOS los clientes.
  const [clients, setClients] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState({
    clients: [],
    projectNames: [],
    sows: [],
    leadDevelopers: [],
    expFrom: '',
    expTo: '',
  })
  const [statusFilter, setStatusFilter] = useState(null) // null | 'Expired' | …
  const [form, setForm] = useState(null) // null | { mode:'edit', project } — campos legacy, cualquier proyecto
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardEditing, setWizardEditing] = useState(null) // "Edit SOW & Scope" — solo proyectos con clientId
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // clients alimenta el filtro de Cliente (resolver grupo→cliente + lista del
    // maestro), pero NO es esencial para ver los proyectos: si su fetch falla
    // (permisos, modo http donde clients.list no está implementado, red), se
    // degrada a [] y la grilla igual se muestra; sólo se ve el filtro sin
    // resolver. Antes Projects cargaba independiente de la tabla clients.
    // El fetch se envuelve en Promise.resolve().then(...) porque el stub http
    // (notImplemented) LANZA de forma síncrona: un `.catch` pelado no lo atraparía
    // —el throw ocurre al construir el array, antes de encadenar el catch—.
    const clientsList = Promise.resolve()
      .then(() => api.clients.list())
      .catch(() => [])
    Promise.all([api.projects.list(), clientsList])
      .then(([projectRows, clientRows]) => {
        if (cancelled) return
        setProjects(projectRows)
        setClients(clientRows)
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

  // Cliente resuelto de cada proyecto (cadena manual→grupo→legacy; ver
  // clientResolver). Un proyecto cuyo grupo de Zoho es "GS3" resuelve al cliente
  // "GS3" aunque el texto plano projects.client venga vacío. Se guarda en un
  // campo aparte (resolvedClient) para NO pisar projects.client, que detail/edit
  // siguen usando tal cual llega del sync.
  const withClient = useMemo(() => {
    const resolve = buildClientResolver(clients)
    // resolve() ya cae al texto legacy (customerName || client) en su último paso,
    // y sólo devuelve null cuando el proyecto no tiene ni grupo reclamado ni texto
    // legacy — es decir, cuando p.client también está vacío. Por eso alcanza con
    // `?? ''`; un `?? p.client` extra sería código muerto.
    return projects.map((p) => ({ ...p, resolvedClient: resolve(p).client ?? '' }))
  }, [projects, clients])

  // Nombres del maestro (los mismos que la página Clients), para saber qué
  // resolvedClient cae "en el maestro" y qué cae en el centinela Others.
  const masterNames = useMemo(
    () => new Set(clients.map((c) => c.clientName).filter(Boolean)),
    [clients],
  )

  // El desplegable Client lista SÓLO los clientes del maestro; cada proyecto se
  // filtra por el cliente que resuelve su Project Group (resolvedClient). Los
  // proyectos cuyo resolvedClient no está en el maestro (legacy o sin cliente) se
  // agrupan bajo la opción centinela Others, que se agrega al final sólo si hay al
  // menos uno — así la lista queda idéntica a la de Clients sin dejar esos
  // proyectos fuera de todo filtro. Mismo armado que Entries y Billing.
  const clientOptions = useMemo(
    () => clientFilterOptions(clients, withClient.some((p) => !masterNames.has(p.resolvedClient))),
    [clients, withClient, masterNames],
  )
  const leadDevOptions = useMemo(
    () => [...new Set(projects.map((p) => p.leadDeveloper).filter(Boolean))].sort(),
    [projects],
  )
  const projectNameOptions = useMemo(
    () => [...new Set(projects.map((p) => p.projectName).filter(Boolean))].sort(),
    [projects],
  )
  // Los SOW de un proyecto viven en dos lugares: el sowNumber de proyecto y, si
  // tiene stages, un SOW por stage (stageSowNumbers, cargado en batch por
  // getProjects). El filtro y la columna consideran ambos. Ver projectsData.js.
  const sowOptions = useMemo(
    () =>
      [
        ...new Set(
          projects.flatMap((p) => projectSows(p)),
        ),
      ].sort(),
    [projects],
  )

  const statusCounts = useMemo(() => countByStatus(projects), [projects])

  const visible = useMemo(() => {
    const filtered = withClient.filter((p) => {
      if (filters.clients.length) {
        // La clave del proyecto es su cliente del maestro, o el centinela Others si
        // resuelve fuera de él (legacy o sin cliente) — mismo criterio que
        // applyEntryFilters usa en Entries/Billing (clientFilterKey).
        if (!filters.clients.includes(clientFilterKey(p.resolvedClient, masterNames))) {
          return false
        }
      }
      if (filters.projectNames.length && !filters.projectNames.includes(p.projectName))
        return false
      if (filters.sows.length) {
        const sows = projectSows(p)
        if (!filters.sows.some((s) => sows.includes(s))) return false
      }
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
  }, [withClient, filters, statusFilter, masterNames])

  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))

  const filtersActive =
    filters.clients.length ||
    filters.projectNames.length ||
    filters.sows.length ||
    filters.leadDevelopers.length ||
    filters.expFrom ||
    filters.expTo

  function handleExport(format) {
    const cols = [
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'projectName' },
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Contract #', key: 'contractNumber' },
      { header: 'SOW', key: 'sows' },
      { header: 'Base Budget Hours', key: 'baseBudgetHours' },
      { header: 'Lead Dev', key: 'leadDeveloper' },
      { header: 'Approver', key: 'approver' },
      { header: 'Contract Expiration', key: 'contractExpirationDate' },
      { header: 'Status', key: 'contractStatus' },
      { header: 'Days Left', key: 'daysLeft' },
    ]
    const exportRows = visible.map((p) => ({
      ...p,
      // La columna Client del export usa el cliente resuelto, igual que la grilla.
      client: p.resolvedClient || '',
      // SOW de proyecto + SOW de cada stage, igual que la columna de la grilla.
      sows: projectSows(p).join(', '),
      contractStatus: contractStatus(daysRemaining(p.contractExpirationDate)),
      daysLeft: daysRemaining(p.contractExpirationDate),
    }))
    exportGrid({ rows: exportRows, columns: cols, title: 'Projects and SOW', gridName: 'projects', format, generatedBy: user?.email ?? '' })
  }

  // rowToProject devuelve stageSowNumbers vacío (solo getProjects lo llena con
  // su query batch). Tras crear/editar un proyecto, re-consultamos sus stages
  // para que la columna y el filtro SOW no queden desactualizados hasta
  // recargar. Se consulta siempre (no se asume que hasStages venga al día tras
  // el guardado): sin stages devuelve [] y queda igual. No crítico: si la
  // consulta falla, se deja como está y se corrige en el próximo getProjects.
  // Ver projectsData.js.
  async function withStageSows(project) {
    try {
      const stages = await api.projects.getStages(project.id)
      return { ...project, stageSowNumbers: stages.map((s) => s.sowNumber).filter(Boolean) }
    } catch (error) {
      console.warn('No se pudieron refrescar los SOW de stage tras guardar:', error?.message)
      return project
    }
  }

  /**
   * Alta desde el wizard de Projects and SOW. La orquestación (subir SOWs,
   * crear el proyecto, sus stages/tasks, versionar documentos) vive en
   * api.projects.createFromWizard — acá solo quedan las consecuencias de UI.
   */
  async function handleCreateFromWizard(payload) {
    const { project, partialFailure } = await api.projects.createFromWizard(payload, user?.email ?? null)

    api.audit.log({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      after: { projectNumber: project.projectNumber, projectName: project.projectName, client: project.client },
    })
    // Se adjuntan los SOW de stage del proyecto recién creado antes de meterlo
    // en la lista, para que la columna y el filtro SOW queden al día sin
    // recargar (mismo patrón que handleUpdateFromWizard).
    const withSows = await withStageSows(project)
    setProjects((prev) => sortByExp([withSows, ...prev]))
    setWizardOpen(false)

    if (partialFailure) {
      // No hay política de borrado para projects (se conserva el historial a
      // propósito, ver 0004_projects.sql) — el proyecto ya quedó creado, así
      // que no lo tratamos como un fallo total: queda en la lista y avisamos
      // qué falta.
      console.error('[projects] stages/tasks no se pudieron guardar tras crear el proyecto —', partialFailure)
      setToast({
        id: Date.now(),
        tone: 'error',
        message: `Project "${project.projectName}" was created, but its stages/tasks could not be saved (${partialFailure.message ?? 'unknown error'}). Contact an admin to add them.`,
      })
    } else {
      setToast({ id: Date.now(), message: `Project created: ${project.projectName}` })
    }
  }

  async function handleUpdate(payload) {
    const updated = await api.projects.update(form.project, payload, user?.email ?? null)
    api.audit.log({ actorEmail: user?.email, actorRole: profile?.roles?.[0] ?? null, action: 'project.update', resourceType: 'project', resourceId: updated.id, before: { projectNumber: form.project.projectNumber }, after: { projectNumber: updated.projectNumber, projectName: updated.projectName, client: updated.client } })
    // El form no-wizard no edita stages: se preserva el stageSowNumbers que ya
    // tenía la fila (updated viene con [] de rowToProject).
    setProjects((prev) =>
      sortByExp(
        prev.map((p) =>
          p.id === updated.id
            ? { ...updated, stageSowNumbers: p.stageSowNumbers ?? [] }
            : p,
        ),
      ),
    )
    setForm(null)
    setToast({ id: Date.now(), message: `Project updated: ${updated.projectName}` })
  }

  /**
   * Edición tabulada (ProjectWizardModal en modo edit, issue 03a) — solo
   * proyectos con clientId. `newSowFile` es el reemplazo del SOW a nivel
   * proyecto si el usuario tocó "Replace" (null si no); se sube y versiona
   * antes de actualizar el proyecto, mismo orden que el resto de los
   * reemplazos de documento (upload → update row → recordDocument).
   * `childChanges` (issues 03b/03c): { changedStages, addedStages,
   * existingStagesCount, changedTasks, addedTasks } — stages solo si el
   * proyecto las tiene, tasks siempre.
   */
  async function handleUpdateFromWizard(updates, newSowFile, childChanges) {
    let sowUrl = wizardEditing.sowUrl
    if (newSowFile) {
      sowUrl = await api.projects.uploadSowFile(newSowFile)
    }
    let updated
    try {
      updated = await api.projects.update(
        wizardEditing,
        newSowFile ? { ...updates, sowUrl } : updates,
        user?.email ?? null,
      )
    } catch (error) {
      // El archivo ya se subió a Storage antes del update — si el update
      // falla, no queda ninguna fila que lo referencie (mismo riesgo de
      // huérfano que createProjectFromWizard ya cubre para el alta).
      if (newSowFile) await api.projects.removeSowFiles([sowUrl])
      throw error
    }
    // recordDocument (recordProjectDocument) es best-effort y nunca tira —
    // solo loggea con console.warn si falla, como logAudit — así que no hay
    // nada real que capturar acá; envolverlo en try/catch sería código
    // muerto (ver la propia doc de la función en projectsData.js).
    if (newSowFile) {
      await api.projects.recordDocument({
        subjectType: 'sow',
        subjectId: updated.id,
        fileUrl: sowUrl,
        uploadedBy: user?.email ?? null,
      })
    }

    // Cada stage cambiada es independiente de las demás — en paralelo, igual
    // que el bloque de abajo para las agregadas (antes era un for-of
    // secuencial sin motivo, multiplicaba la latencia por cantidad de stages).
    await Promise.all(
      (childChanges?.changedStages ?? []).map(async (stage) => {
        let stageSowUrl = null
        if (stage.sowFile) {
          stageSowUrl = await api.projects.uploadSowFile(stage.sowFile)
        }
        try {
          // `stage` viaja completo (id, projectId, position, sowUrl, etc. —
          // ver ProjectWizardModal) porque updateStage en modo demo hace
          // `{...current, ...updates}`; el path real de Supabase solo usa
          // stage.id.
          await api.projects.updateStage(stage, {
            stageName: stage.stageName,
            sowNumber: stage.sowNumber,
            ...(stageSowUrl ? { sowUrl: stageSowUrl } : {}),
          })
        } catch (error) {
          if (stageSowUrl) await api.projects.removeSowFiles([stageSowUrl])
          throw error
        }
        if (stageSowUrl) {
          await api.projects.recordDocument({
            subjectType: 'sow',
            subjectId: stage.id,
            fileUrl: stageSowUrl,
            uploadedBy: user?.email ?? null,
          })
        }
      }),
    )

    if (childChanges?.addedStages?.length) {
      // allSettled, no all: si uno de los uploads falla, los que sí
      // terminaron no deben quedar huérfanos en Storage sin limpiar (mismo
      // motivo que createProjectFromWizard ya documenta para el alta).
      const uploadResults = await Promise.allSettled(
        childChanges.addedStages.map((s) =>
          api.projects
            .uploadSowFile(s.sowFile)
            .then((sowUrl) => ({ stageName: s.stageName, sowNumber: s.sowNumber, sowUrl })),
        ),
      )
      const firstUploadFailure = uploadResults.find((r) => r.status === 'rejected')
      const uploadedPaths = uploadResults.filter((r) => r.status === 'fulfilled').map((r) => r.value.sowUrl)
      if (firstUploadFailure) {
        await api.projects.removeSowFiles(uploadedPaths)
        throw firstUploadFailure.reason
      }
      const uploaded = uploadResults.map((r) => r.value)
      let createdStages
      try {
        createdStages = await api.projects.createStages(
          updated.id,
          uploaded,
          user?.email ?? null,
          childChanges.existingStagesCount,
        )
      } catch (error) {
        await api.projects.removeSowFiles(uploadedPaths)
        throw error
      }
      await Promise.all(
        createdStages.map((stage, i) =>
          api.projects.recordDocument({
            subjectType: 'sow',
            subjectId: stage.id,
            fileUrl: uploaded[i].sowUrl,
            uploadedBy: user?.email ?? null,
          }),
        ),
      )
    }

    // Tasks (issue 03c): sin archivo, no hay riesgo de huérfano en Storage —
    // update/create en paralelo, cada task es independiente de las demás.
    await Promise.all(
      (childChanges?.changedTasks ?? []).map((task) =>
        api.projectTasks.update(task, {
          taskName: task.taskName,
          role: task.role,
          estimatedHours: task.estimatedHours,
        }),
      ),
    )
    if (childChanges?.addedTasks?.length) {
      await api.projectTasks.create(updated.id, childChanges.addedTasks, user?.email ?? null)
    }

    api.audit.log({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'project.update',
      resourceType: 'project',
      resourceId: updated.id,
      before: { projectNumber: wizardEditing.projectNumber },
      after: { projectNumber: updated.projectNumber, projectName: updated.projectName, client: updated.client },
    })
    // El wizard pudo editar/agregar stages: se re-consultan sus SOW para que la
    // columna y el filtro reflejen los cambios sin recargar.
    const updatedWithSows = await withStageSows(updated)
    setProjects((prev) => sortByExp(prev.map((p) => (p.id === updatedWithSows.id ? updatedWithSows : p))))
    setWizardEditing(null)
    setToast({ id: Date.now(), message: `Project updated: ${updated.projectName}` })
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
                label="Project"
                options={projectNameOptions}
                selected={filters.projectNames}
                onToggle={(v) => toggle('projectNames', v)}
              />
              <MultiSelectDropdown
                label="SOW"
                options={sowOptions}
                selected={filters.sows}
                onToggle={(v) => toggle('sows', v)}
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
                    setFilters({
                      clients: [],
                      projectNames: [],
                      sows: [],
                      leadDevelopers: [],
                      expFrom: '',
                      expTo: '',
                    })
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
                    <th scope="col" className="col-num">Base Budget Hours</th>
                    <th scope="col">Proposal #</th>
                    <th scope="col">Approver</th>
                    <th scope="col">Cust. Manager</th>
                    <th scope="col">Lead Dev</th>
                    <th scope="col">Contract #</th>
                    <th scope="col">SOW</th>
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
                        <td>{p.resolvedClient || '—'}</td>
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
                        <td className="col-num cell-mono">
                          {p.baseBudgetHours != null ? formatHours(p.baseBudgetHours) : '—'}
                        </td>
                        <td className="cell-mono">{p.proposalNumber || '—'}</td>
                        <td>{p.approver || '—'}</td>
                        <td>{p.customerManager || '—'}</td>
                        <td>{p.leadDeveloper || '—'}</td>
                        <td className="cell-mono">{p.contractNumber || '—'}</td>
                        <td className="cell-mono">
                          {projectSows(p).join(', ') || '—'}
                        </td>
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
        {wizardEditing && (
          <ProjectWizardModal
            key={`edit-wizard-${wizardEditing.id}`}
            initial={wizardEditing}
            onClose={() => setWizardEditing(null)}
            onSubmit={handleUpdateFromWizard}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <ProjectDetailCarousel
            key={`detail-${detail.id}`}
            project={detail}
            uploadedBy={user?.email ?? null}
            canEditAssignments={can('assignments.edit')}
            canCreateChangeRequests={can('changeRequests.create')}
            canDecideChangeRequests={can('changeRequests.decide')}
            onClose={() => setDetail(null)}
            onEdit={() => {
              // Siempre disponible, para cualquier proyecto: Contract Number,
              // Contract Expiration Date, Approver, Customer Manager, etc. no
              // tienen equivalente en el wizard, y un proyecto con clientId
              // también puede necesitarlos (ej. vencimiento de contrato para
              // las alertas) — no es exclusivo de los legacy sincronizados de Zoho.
              const project = detail
              setDetail(null)
              setForm({ mode: 'edit', project })
            }}
            onEditSow={
              detail.clientId
                ? () => {
                    const project = detail
                    setDetail(null)
                    setWizardEditing(project)
                  }
                : undefined
            }
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
