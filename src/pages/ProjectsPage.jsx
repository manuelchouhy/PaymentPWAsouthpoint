import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Plus } from 'lucide-react'
import {
  CONTRACT_STATUSES,
  contractStatus,
  countByStatus,
  daysRemaining,
  isActiveProject,
} from '../lib/projectsData'
import { projectSows, stageSows } from '../lib/projectSows'
import { api } from '../lib/api'
import { buildClientResolver } from '../lib/clientResolver'
import { useSyncReloadKey } from '../lib/useSyncReload'
import { useStageFilter } from '../lib/useStageFilter'
import { projectMatchesStages, projectStageIds } from '../lib/stageFilter'
import { clientFilterKey, clientFilterOptions, sortedUnique, OTHER_CLIENT } from '../lib/useEntryFilters'
import { formatDate, formatHours } from '../lib/format'
import { ContractBadge } from '../components/ContractBadge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ProjectFormModal } from '../components/ProjectFormModal'
import { ProjectWizardModal } from '../components/ProjectWizardModal'
import { BudgetHoursModal } from '../components/BudgetHoursModal'
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
    projectNumbers: [],
    sows: [],
    leadDevelopers: [],
    expFrom: '',
    expTo: '',
  })
  const [statusFilter, setStatusFilter] = useState(null) // null | 'Expired' | …
  // Por defecto el listado muestra sólo proyectos Active / In Progress de Zoho
  // (isActiveProject) — y como el listado es el punto de entrada al trabajo nuevo
  // (click en la fila → detalle), eso acota el trabajo nuevo a proyectos en curso.
  // El toggle deja ver TODOS los estados para gestión; no se borra ni oculta nada
  // de forma permanente (el sync sigue trayendo todos con su estado real). Las
  // vistas financieras/históricas NO usan este filtro (ver isActiveProject).
  const [showAllStatuses, setShowAllStatuses] = useState(false)
  const [form, setForm] = useState(null) // null | { mode:'edit', project } — campos legacy, cualquier proyecto
  const [wizardOpen, setWizardOpen] = useState(false)
  const [budgetEditing, setBudgetEditing] = useState(null) // "Edit Budget Hours" — cualquier proyecto editable
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)

  const reloadKey = useSyncReloadKey()
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
  }, [reloadKey])

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

  // Filtro de Stage (ver "Filtro de Stage" en CONTEXT.md): en Projects es un filtro de FILA
  // (proyecto que TIENE el stage; la fila se muestra entera — decisión (A) del PRD). No hace
  // falta la membresía task→stage (withMembership:false): sólo qué stages tiene cada proyecto,
  // que sale de stagesByProject (getAllStages).
  const {
    selectedStageIds,
    stageFilterActive,
    toggleStage,
    clearStages,
    stagesByProject,
    buildOptions,
  } = useStageFilter({ withMembership: false, projects, reloadKey })

  // Aplica el filtro de status (activo/todos) a una lista de proyectos. Un solo
  // lugar para el criterio, así las opciones y la grilla no se desincronizan.
  const applyStatusScope = (list) => (showAllStatuses ? list : list.filter(isActiveProject))

  // Base de las opciones de filtro (nombre, #, SOW, lead dev y el centinela Others
  // del filtro Client): sale del MISMO conjunto que muestra la grilla según el
  // status, para no ofrecer un valor de un proyecto oculto que filtraría a cero. Con
  // "Show all statuses" cubre todos.
  const optionWithClient = useMemo(
    () => applyStatusScope(withClient),
    [withClient, showAllStatuses],
  )

  // El desplegable Client lista SÓLO los clientes del maestro; cada proyecto se
  // filtra por el cliente que resuelve su Project Group (resolvedClient). Los
  // proyectos cuyo resolvedClient no está en el maestro (legacy o sin cliente) se
  // agrupan bajo la opción centinela Others, que se agrega al final sólo si hay al
  // menos uno EN EL SCOPE de status — o si ya está seleccionado, para que siga
  // siendo destildable aunque el toggle de status lo saque del scope (mismo criterio
  // que las otras opciones). Mismo armado que Entries y Billing.
  // Predicado ÚNICO de match de un proyecto contra los filtros (multi-selects + rango de
  // exp + tarjeta de estado). `skip` (opcional) omite una dimensión, para cruzar SUS
  // opciones. Lo usan tanto la grilla (filteredIgnoringActive, sin skip) como el
  // interlazado de opciones (optionScope, con skip) — una sola fuente de verdad para que
  // las opciones nunca ofrezcan valores que la grilla filtra a cero.
  const matchesProject = useCallback(
    (p, skip) => {
      if (
        skip !== 'clients' &&
        filters.clients.length &&
        !filters.clients.includes(clientFilterKey(p.resolvedClient, masterNames))
      )
        return false
      if (
        skip !== 'projectNames' &&
        filters.projectNames.length &&
        !filters.projectNames.includes(p.projectName)
      )
        return false
      if (
        skip !== 'projectNumbers' &&
        filters.projectNumbers.length &&
        !filters.projectNumbers.includes(p.projectNumber)
      )
        return false
      if (skip !== 'sows' && filters.sows.length) {
        const sows = projectSows(p)
        if (!filters.sows.some((s) => sows.includes(s))) return false
      }
      if (
        skip !== 'leadDevelopers' &&
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
    },
    [filters, masterNames, statusFilter],
  )

  // Interlazado de las opciones (igual que Billing/Dashboard con buildFilterOptions):
  // las opciones de cada dimensión se derivan de los proyectos que pasan TODOS los
  // OTROS filtros (menos el de la propia dimensión), para que elegir un Cliente recorte
  // Project/Project#/SOW/Lead Dev y no ofrezca combinaciones que dan cero. Base:
  // optionWithClient (ya scopeado por el toggle de status).
  const optionScope = useCallback(
    (exceptKey) => optionWithClient.filter((p) => matchesProject(p, exceptKey)),
    [optionWithClient, matchesProject],
  )

  const clientOptions = useMemo(
    () =>
      clientFilterOptions(
        clients,
        optionScope('clients').some((p) => !masterNames.has(p.resolvedClient)) ||
          filters.clients.includes(OTHER_CLIENT),
      ),
    [clients, optionScope, masterNames, filters.clients],
  )
  // Cada lista de opciones UNE el scope (cruzado) con lo ya seleccionado: así un
  // valor elegido sigue siendo destildable aunque el cruce con las otras dimensiones
  // lo saque del scope (si no, quedaría un filtro puesto imposible de quitar salvo Clear).
  const leadDevOptions = useMemo(
    () => sortedUnique([...optionScope('leadDevelopers').map((p) => p.leadDeveloper), ...filters.leadDevelopers]),
    [optionScope, filters.leadDevelopers],
  )
  const projectNameOptions = useMemo(
    () => sortedUnique([...optionScope('projectNames').map((p) => p.projectName), ...filters.projectNames]),
    [optionScope, filters.projectNames],
  )
  // sortedUnique: dedup + orden natural (numeric) — 'PRJ-2' antes de 'PRJ-10'.
  const projectNumberOptions = useMemo(
    () => sortedUnique([...optionScope('projectNumbers').map((p) => p.projectNumber), ...filters.projectNumbers]),
    [optionScope, filters.projectNumbers],
  )
  // Los SOW de un proyecto viven en dos lugares: el sowNumber de proyecto y, si
  // tiene stages, un SOW por stage (stageSowNumbers, cargado en batch por
  // getProjects). El filtro y la columna consideran ambos. Ver projectsData.js.
  const sowOptions = useMemo(
    () => sortedUnique([...optionScope('sows').flatMap((p) => projectSows(p)), ...filters.sows]),
    [optionScope, filters.sows],
  )

  // Las tarjetas de estado de contrato son un monitor de vencimientos (FR-08):
  // cuentan sobre TODOS los proyectos, independientes del filtro de status del
  // listado, para no esconder un contrato por vencer de un proyecto On Hold/Completed.
  // Por eso el número de la tarjeta puede ser mayor que las filas que muestra al
  // clickearla mientras el listado está en "sólo activos" — el toggle "Show all
  // statuses" reconcilia ambos. (Los demás filtros tampoco se reflejan en el conteo.)
  const statusCounts = useMemo(() => countByStatus(projects), [projects])

  // Aplica TODOS los filtros MENOS el de status (activo/todos). De acá salen tanto
  // `visible` (agregándole el filtro de status) como el empty-state hint: si esto
  // tiene filas pero `visible` no, el vacío se debe al filtro de status.
  const filteredIgnoringActive = useMemo(() => {
    // Mismo predicado que el interlazado de opciones, sin omitir ninguna dimensión.
    return sortByExp(withClient.filter((p) => matchesProject(p)))
  }, [withClient, matchesProject])

  // Row-filter de Stage: proyecto que TIENE alguno de los stages elegidos (fila entera). Sin
  // stages elegidos no filtra. Callback reusado por la grilla y por el empty-state.
  const applyStageFilter = useCallback(
    (list) =>
      stageFilterActive
        ? list.filter((p) => projectMatchesStages(stagesByProject.get(String(p.id)), selectedStageIds))
        : list,
    [stageFilterActive, stagesByProject, selectedStageIds],
  )

  // Proyectos que pasan TODOS los filtros de la barra + el status scope, ANTES del filtro de
  // Stage. Base de las opciones de Stage (interlazado) — status-scoped como el resto de los
  // dropdowns, para no ofrecer stages que dejarían la grilla en cero (invariante de la página).
  const statusScoped = useMemo(
    () => applyStatusScope(filteredIgnoringActive),
    [filteredIgnoringActive, showAllStatuses],
  )

  // Opciones del filtro de Stage: los stage_id de los proyectos en scope (statusScoped),
  // interlazado. buildOptions une los ya seleccionados fuera de scope y arma el rótulo con
  // prefijo condicional por proyecto.
  const { optionIds: stageOptionIds, getLabel: stageLabel } = useMemo(() => {
    const present = new Set()
    for (const p of statusScoped) {
      for (const sid of projectStageIds(stagesByProject.get(String(p.id)))) present.add(sid)
    }
    return buildOptions([...present])
  }, [statusScoped, stagesByProject, buildOptions])

  // Grilla final: status scope + row-filter de Stage. Los manuales (sin zohoProjectId) nunca se
  // ocultan por status (isActiveProject).
  const visible = useMemo(() => applyStageFilter(statusScoped), [applyStageFilter, statusScoped])

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
    filters.projectNumbers.length ||
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
    // Solo si el proyecto tiene stages: si pasó a has_stages=false (Edit SOW), sus
    // project_stages quedan huérfanos en la DB (no hay borrado) y NO deben reaparecer
    // como SOW fantasma en la columna/filtro. Mismo criterio que getProjects.
    if (!project.hasStages) return { ...project, stageSowNumbers: [] }
    try {
      const stages = await api.projects.getStages(project.id)
      return { ...project, stageSowNumbers: stageSows(stages) }
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
    // recargar (mismo patrón que handleSaveBudgets).
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
    api.audit.log({ actorEmail: user?.email, actorRole: profile?.roles?.[0] ?? null, action: 'project.update', resourceType: 'project', resourceId: updated.id, before: { projectNumber: form.project.projectNumber, baseBudgetHours: form.project.baseBudgetHours ?? null }, after: { projectNumber: updated.projectNumber, projectName: updated.projectName, client: updated.client, baseBudgetHours: updated.baseBudgetHours ?? null } })
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
   * Guardado del editor "Edit Budget Hours" (reemplaza al wizard "Edit SOW &
   * Scope" en edición). `plan` viene de buildBudgetSavePlan y trae SOLO lo que
   * cambió: budget a nivel proyecto (proyectos sin stages), budget por stage, y/o
   * el stage activo. No agrega ni elimina stages/tasks. Corrige/carga un dato: no
   * requiere aprobación, queda auditado (ver CONTEXT.md, base budget vs CR).
   */
  async function handleSaveBudgets(plan) {
    const project = budgetEditing

    // Los budgets de stage van PRIMERO. Cada uno es independiente — en paralelo;
    // solo llegan los que cambiaron (el plan ya filtró). `projectId` viaja para el
    // path demo de updateStage; el real solo usa el id. Si alguno falla, se corta
    // acá y el cambio a nivel proyecto (base/activo) NO se commitea, así no queda
    // un cambio auditado a medias. (Atomicidad total sobre ambas tablas requeriría
    // un RPC transaccional — follow-up.)
    await Promise.all(
      (plan.stageBudgetChanges ?? []).map((c) =>
        api.projects.updateStage({ id: c.id, projectId: project.id }, { budgetHours: c.value }),
      ),
    )

    const projectUpdates = {}
    if (plan.baseBudgetChange) projectUpdates.baseBudgetHours = plan.baseBudgetChange.value
    if (plan.activeStageChange) projectUpdates.activeStageId = plan.activeStageChange.value

    let updated = project
    if (Object.keys(projectUpdates).length) {
      updated = await api.projects.update(project, projectUpdates, user?.email ?? null)
    }

    api.audit.log({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'project.update',
      resourceType: 'project',
      resourceId: project.id,
      before: { baseBudgetHours: project.baseBudgetHours ?? null, activeStageId: project.activeStageId ?? null },
      after: {
        baseBudgetHours: updated.baseBudgetHours ?? null,
        activeStageId: updated.activeStageId ?? null,
        stageBudgetChanges: plan.stageBudgetChanges ?? [],
      },
    })

    // Re-consulta los SOW de las stages para que la columna/filtro reflejen sin
    // recargar (mismo patrón que tenía la edición por wizard).
    const updatedWithSows = await withStageSows(updated)
    setProjects((prev) => sortByExp(prev.map((p) => (p.id === updatedWithSows.id ? updatedWithSows : p))))
    setBudgetEditing(null)
    setToast({ id: Date.now(), message: `Budget updated: ${project.projectName}` })
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
                label="Project #"
                options={projectNumberOptions}
                selected={filters.projectNumbers}
                onToggle={(v) => toggle('projectNumbers', v)}
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
              {/* Filtro de Stage (row-filter): muestra los proyectos que TIENEN el/los
                  stage(s) elegido(s). Sus opciones salen de los proyectos que pasan los otros
                  filtros (interlazado one-directional, igual que el resto de la familia: elegir
                  un stage no reduce los otros dropdowns). Sólo aparece si hay stages en scope. */}
              {stageOptionIds.length > 0 && (
                <MultiSelectDropdown
                  label="Stage"
                  options={stageOptionIds}
                  selected={[...selectedStageIds]}
                  getLabel={stageLabel}
                  onToggle={toggleStage}
                />
              )}
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
              {filtersActive || stageFilterActive ? (
                <button
                  type="button"
                  className="btn btn--ghost filterbar__clear"
                  onClick={() => {
                    setFilters({
                      clients: [],
                      projectNames: [],
                      projectNumbers: [],
                      sows: [],
                      leadDevelopers: [],
                      expFrom: '',
                      expTo: '',
                    })
                    clearStages()
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </section>

          <div className="toolbar">
            <label className="settings-check toolbar__toggle">
              <input
                type="checkbox"
                checked={showAllStatuses}
                onChange={(e) => setShowAllStatuses(e.target.checked)}
              />
              Show all statuses
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ExportDropdown onExport={handleExport} />
              <span className="toolbar__count">
                {visible.length} {visible.length === 1 ? 'project' : 'projects'}
              </span>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              {/* Sólo culpar al status cuando prender "Show all statuses" REALMENTE traería
                  filas dado el filtro de Stage actual: aplicamos el filtro de Stage sin el
                  status scope; si eso tiene filas y la grilla no, la causa es el status. Si no,
                  la causa es otro filtro (p. ej. Stage) y el mensaje genérico no engaña. */}
              {!showAllStatuses && applyStageFilter(filteredIgnoringActive).length > 0
                ? 'No active projects to display. Some are hidden by their status — turn on “Show all statuses” to see them.'
                : 'No projects to display.'}
            </div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table proj-table--fit">
                <thead>
                  <tr>
                    <th scope="col">Project #</th>
                    <th scope="col">Project Name</th>
                    <th scope="col">Client</th>
                    <th scope="col">Zoho Status</th>
                    <th scope="col">Customer</th>
                    <th scope="col" className="col-num">Base Budget Hours</th>
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
                        <td className="cell-mono">{p.projectNumber}</td>
                        <td className="cell-strong">{p.projectName}</td>
                        <td>{p.resolvedClient || '—'}</td>
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
        {budgetEditing && (
          <BudgetHoursModal
            key={`edit-budget-${budgetEditing.id}`}
            project={budgetEditing}
            onClose={() => setBudgetEditing(null)}
            onSubmit={handleSaveBudgets}
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
            onEditBudget={
              can('projects.edit')
                ? () => {
                    const project = detail
                    setDetail(null)
                    setBudgetEditing(project)
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
