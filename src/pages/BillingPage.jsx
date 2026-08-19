import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { useEntryFilters, applyEntryFilters, buildFilterOptions } from '../lib/useEntryFilters'
import { deriveEntriesClient } from '../lib/entryClient'
import { groupBillToClient } from '../lib/billingGrouping'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'
import { BillModal } from '../components/BillModal'

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

// Un proyecto se identifica por cliente + nombre, no por nombre solo.
const sowKey = (client, projectName) => `${client ?? ''}||${projectName ?? ''}`

// Clave de una semana dentro de un cliente (para colapsar/expandir).
const weekId = (client, week) => `${client}||${week.weekNum ?? 'na'}`

// Por qué una hora quedó "sin cliente" (motivo que expone clientResolver).
const REASON_LABEL = {
  'group-unclaimed': 'Project group has no client assigned',
  'no-group': 'Project has no Zoho group',
}
const reasonLabel = (reason) => REASON_LABEL[reason] ?? 'Unresolved'

export function BillingPage() {
  const { user, profile, can } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [sowByProject, setSowByProject] = useState(() => ({
    byClientAndName: new Map(),
    byName: new Map(),
  }))
  // projects + clients alimentan deriveEntriesClient (cadena hora→proyecto→grupo→
  // cliente). Ver entryClient.js / clientResolver.js.
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  // Semanas colapsadas: por defecto todas menos la más reciente de cada cliente.
  const [collapsedWeeks, setCollapsedWeeks] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { filters, toggleValue, clear, isActive } = useEntryFilters()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // Los proyectos son sólo para etiquetar el SOW de cada fila: van aparte de
    // Promise.all y con catch propio para que un fallo suyo no tire la pantalla
    // entera, que sí puede facturar sin ese dato.
    Promise.resolve()
      .then(() => api.projects.list())
      .then((projectRows) => {
        if (cancelled) return
        // Dos claves por proyecto, porque ninguna sola alcanza:
        //
        // - cliente+nombre: dos clientes pueden tener un proyecto llamado igual
        //   ("Maintenance") con SOW distintos, y con la clave sólo por nombre
        //   el último en cargarse le pisa el número al otro.
        // - nombre solo, como fallback: `projects.client` no siempre trae el
        //   mismo texto que `entry.client` (el wizard escribe el nombre
        //   canónico del cliente, las entries traen el de Zoho), así que
        //   exigir que coincidan haría desaparecer la etiqueta.
        //
        // El fallback se guarda SÓLO si el nombre es inequívoco entre todos los
        // proyectos. Ante dos proyectos homónimos se prefiere no mostrar SOW
        // antes que mostrar el del otro: en una grilla previa a facturar, un
        // número equivocado es peor que ninguno.
        //
        // Van en dos Maps separados a propósito: con uno solo, un proyecto sin
        // cliente escribe la clave `"||Nombre"`, que es exactamente la que usa
        // el fallback — y entonces el descarte por ambigüedad no lo borraba y
        // terminaba sirviendo justo el SOW que había que ocultar.
        const byClientAndName = new Map()
        const byName = new Map()
        for (const project of projectRows) {
          if (!project.projectName || !project.sowNumber) continue
          byClientAndName.set(sowKey(project.client, project.projectName), project.sowNumber)
          const prior = byName.get(project.projectName)
          if (prior === undefined) byName.set(project.projectName, project.sowNumber)
          else if (prior !== project.sowNumber) byName.set(project.projectName, null)
        }
        setSowByProject({ byClientAndName, byName })
        // Los proyectos también resuelven el cliente de cada hora (deriveEntriesClient,
        // abajo): time_entries.client viene vacío del sync. Ver entryClient.js.
        setProjects(projectRows)
      })
      .catch((error) => console.error('No se pudieron cargar los SOW de Billing:', error))

    Promise.all([api.timeEntries.list(), api.invoices.list(), api.clients.list()])
      .then(([entryRows, invoiceRows, clientRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
        setClients(clientRows)
        setSelectedKeys(new Set())
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Billing:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const invoiceByEntryId = useMemo(() => {
    const map = new Map()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds ?? []) map.set(String(entryId), invoice)
    }
    return map
  }, [invoices])

  // Con el cliente ya resuelto desde el proyecto (por id de Zoho → grupo →
  // cliente), para que la columna, el filtro y sus opciones hablen todos del
  // mismo valor. Pre-sync (columnas zoho_* vacías) degrada al texto legacy del
  // proyecto, igual que el camino anterior.
  const entriesConCliente = useMemo(
    () => deriveEntriesClient(entries, projects, clients),
    [entries, projects, clients],
  )

  // Listas entrelazadas: cada dropdown se arma sobre lo que pasa los OTROS
  // filtros (ver buildFilterOptions) — elegir un proyecto recorta la lista de
  // contractors a los que cargaron horas ahí.
  //
  // El cruce se hace sobre todas las entries, no sólo las bill_to_client: las
  // tarjetas de facturado cuentan sobre todas, así que un cliente cuyas horas
  // están todas sin clasificar aporta a "Invoiced" y tiene que seguir apareciendo
  // en la lista.
  //
  // LIMITACIONES que el cruce NO arregla, las dos por la misma razón (las
  // opciones se cruzan con los filtros, no con lo que la grilla termina
  // mostrando):
  //  - La grilla mira sólo allocation === 'bill_to_client' (ver `filtered` más
  //    abajo), así que un contractor ofrecido cuyas horas son todas overage o SP
  //    internal deja la grilla vacía aunque las tarjetas muestren números.
  //  - sortedUnique descarta los valores vacíos y rowToEntry normaliza
  //    client/project null a ''. Una entry sin cliente cuenta en las tarjetas
  //    pero no la alcanza ningún filtro, así que tildar todos los clientes puede
  //    dar MENOS que no tildar ninguno. No es teórico: hoy en producción 550 de
  //    559 entries tienen client vacío. Arreglarlo pide una opción explícita
  //    tipo "—" en MultiSelectDropdown, que es compartido por varias pantallas:
  //    va en su propio slice.
  const options = useMemo(
    () => buildFilterOptions(entriesConCliente, filters, invoiceByEntryId),
    [entriesConCliente, filters, invoiceByEntryId],
  )

  // Todas las filas que pasan los filtros del usuario, sin mirar allocation.
  const filteredAllAllocations = useMemo(
    () => applyEntryFilters(entriesConCliente, filters, invoiceByEntryId),
    [entriesConCliente, filters, invoiceByEntryId],
  )

  // La grilla y "Pending to bill" miran sólo horas facturables al cliente:
  // overage y SP internal no se le cobran a nadie acá (el overage se resuelve
  // por Change Request, en Projects and SOW).
  //
  // Se deriva del conjunto de arriba en vez de volver a filtrar desde `entries`:
  // así "las mismas filas menos el filtro de allocation" queda garantizado por
  // construcción y no depende de que dos llamadas a applyEntryFilters sigan
  // sincronizadas.
  const filtered = useMemo(
    () => filteredAllAllocations.filter((e) => e.allocation === 'bill_to_client'),
    [filteredAllAllocations],
  )

  useEffect(() => {
    setSelectedKeys(new Set())
    // El aviso habla de la selección anterior: dejarlo bajo otra grilla filtrada
    // haría dudar de una factura que sí se emitió.
    setNotice('')
  }, [filters])

  const cards = useMemo(() => {
    let pendingToBill = 0
    let pendingCount = 0
    let invoiced = 0
    let collected = 0

    // "Pending to bill" mira SÓLO bill_to_client: es lo que está por entrar al
    // pipeline, y overage o SP internal no se le cobran a nadie acá.
    for (const entry of filtered) {
      if (invoiceByEntryId.has(String(entry.id))) continue
      // Sólo las aprobadas están listas para facturar: una hora rechazada no
      // se le cobra al cliente.
      if (entry.status !== 'Approved') continue
      pendingToBill += Number(entry.hours) || 0
      pendingCount += 1
    }

    // Las tres tarjetas de lo ya facturado NO filtran por allocation, a
    // diferencia de la grilla. Las facturas viejas son anteriores al triage de
    // horas y sus entries tienen allocation en null: exigirles 'bill_to_client'
    // deja estas tarjetas en cero para siempre, que es literalmente lo que
    // pasaba (808 h facturadas en la base, "Invoiced 0.0 h" en pantalla).
    // Una hora que ya se facturó está facturada, sin importar cómo se la haya
    // clasificado después.
    for (const entry of filteredAllAllocations) {
      const invoice = invoiceByEntryId.get(String(entry.id))
      if (!invoice) continue
      const hours = Number(entry.hours) || 0
      invoiced += hours
      // Collected y Paid ya se cobraron: Paid es el paso siguiente (se le pagó
      // al proveedor), no una vuelta atrás.
      if (invoice.status === 'Collected' || invoice.status === 'Paid') collected += hours
    }

    // Filas que el usuario TODAVÍA PUEDE clasificar bajo el filtro actual:
    // aprobadas, sin factura (setEntriesAllocation congela sólo las facturadas)
    // y que aún no son bill_to_client. Es lo que decide si tiene sentido
    // mandarlo a Entries — no alcanza con mirar si hay horas facturadas.
    let classifiable = 0
    for (const entry of filteredAllAllocations) {
      if (entry.status !== 'Approved') continue
      if (invoiceByEntryId.has(String(entry.id))) continue
      if (entry.allocation === 'bill_to_client') continue
      classifiable += 1
    }

    return {
      pendingToBill,
      pendingCount,
      invoiced,
      collected,
      pendingCollection: invoiced - collected,
      classifiable,
    }
  }, [filtered, filteredAllAllocations, invoiceByEntryId])

  // Las horas facturables ordenadas por cliente → semana ISO → filas
  // proveedor·proyecto·task (billingGrouping). "Sin cliente" queda arriba, no es
  // facturable y muestra el motivo de no-resolución por proyecto.
  const clientGroups = useMemo(
    () =>
      groupBillToClient(filtered, {
        isInvoiced: (entry) => invoiceByEntryId.has(String(entry.id)),
      }),
    [filtered, invoiceByEntryId],
  )

  const billableClientCount = clientGroups.filter((g) => !g.isUnassigned).length

  // Índice de filas facturables por clave única (cliente·semana·terna). La
  // selección y la factura trabajan a nivel de fila, no de cliente: una factura
  // cubre UN proveedor, y la misma terna proveedor·proyecto·task puede caer en dos
  // semanas y son filas distintas. El bucket "Sin cliente" no entra: no se factura.
  const billableRows = useMemo(() => {
    const map = new Map()
    for (const group of clientGroups) {
      if (group.isUnassigned) continue
      for (const week of group.weeks) {
        for (const row of week.rows) {
          const rowId = `${group.client}||${week.weekNum ?? 'na'}||${row.key}`
          map.set(rowId, { ...row, rowId, client: group.client, week: week.week })
        }
      }
    }
    return map
  }, [clientGroups])

  // Colapsa por defecto todas las semanas menos la más reciente de cada cliente
  // (weeks[0]). Se recalcula al cambiar el conjunto (otro filtro, una factura
  // nueva); el usuario puede abrir/cerrar a mano después.
  useEffect(() => {
    const collapse = new Set()
    for (const group of clientGroups) {
      if (group.isUnassigned) continue
      group.weeks.forEach((week, i) => {
        if (i > 0) collapse.add(weekId(group.client, week))
      })
    }
    setCollapsedWeeks(collapse)
  }, [clientGroups])

  const selectedRows = [...selectedKeys].map((k) => billableRows.get(k)).filter(Boolean)
  const selectedEntries = selectedRows.flatMap((r) => r.entries)
  const selectedHours = selectedRows.reduce((sum, r) => sum + r.hours, 0)
  const selectedProviders = sortedUnique(selectedRows.map((r) => r.user))
  const allSelected =
    billableRows.size > 0 && [...billableRows.keys()].every((k) => selectedKeys.has(k))
  const canCreate = can('billing.create')
  const canBill = canCreate && selectedEntries.length > 0 && selectedProviders.length === 1

  function toggleGroup(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelectedKeys(allSelected ? new Set() : new Set(billableRows.keys()))
  }

  function toggleWeek(id) {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport(format) {
    const cols = [
      { header: 'Provider', key: 'provider' },
      { header: 'Client', key: 'client' },
      { header: 'Week', key: 'week' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
    ]
    const rows = [...billableRows.values()].map((r) => ({
      provider: r.user,
      client: r.client,
      week: r.week,
      project: r.project,
      task: r.task,
      hours: r.hours,
      entries: r.entries.length,
    }))
    exportGrid({
      rows,
      columns: cols,
      title: 'Billing · ready to bill',
      gridName: 'billing-ready-to-bill',
      format,
      generatedBy: user?.email ?? '',
    })
  }

  async function handleConfirmBill({
    supplierInvoiceNumber,
    invoiceDate,
    currency,
    totalAmount,
    notes,
  }) {
    const entryIds = selectedEntries.map((e) => e.id)
    const provider = selectedProviders[0]
    const { invoice } = await api.invoices.create({
      supplierInvoiceNumber,
      invoiceDate,
      currency,
      totalAmount,
      notes,
      userName: provider,
      entryIds,
      createdBy: user?.email ?? null,
    })
    api.audit.log({
      actorEmail: user?.email,
      // Igual que el resto de los llamadores: sin el rol, el Audit Log muestra
      // la fila en blanco justo donde importa quién la emitió.
      actorRole: profile?.roles?.[0] ?? null,
      action: 'invoice.create',
      resourceType: 'invoice',
      resourceId: invoice.id,
      after: {
        supplierInvoiceNumber,
        invoiceDate,
        totalAmount,
        userName: provider,
        entryCount: entryIds.length,
        source: 'billing',
      },
    })
    setModalOpen(false)
    setNotice(
      `Invoice ${supplierInvoiceNumber} issued for ${provider} — ${formatHours(selectedHours)} h.`,
    )
    // Se relee en vez de parchear: la factura nueva cambia las 4 tarjetas y saca
    // las filas de la grilla, y esos números no se pueden inventar localmente.
    setReloadKey((k) => k + 1)
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
          <span className="masthead__kicker">Billing</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Billing</h1>
        <p className="masthead__sub">
          Hours classified as bill to client, ready to enter the existing invoice pipeline. The
          invoiced totals cover every allocation, including hours billed before triage existed.
        </p>
      </motion.header>

      {/* El aviso NO se oculta cuando la página falla: la factura ya está
          persistida, y esconder su confirmación detrás de "Could not load
          billing data" haría creer que no se emitió y llevaría a emitirla dos
          veces. Se aclara qué fue lo que falló, que era el riesgo de dejar el
          aviso suelto arriba del error. La staleness entre filtros ya la
          resuelve el setNotice('') del efecto de arriba. */}
      {notice && (
        <p className="state__hint">
          {notice}
          {status === 'error' && ' The invoice was created — only the refresh below failed.'}
        </p>
      )}

      {status === 'loading' && <p className="state__hint">Loading billing data…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load billing data</h2>
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
              {isActive && (
                <button type="button" className="btn btn--ghost filterbar__clear" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
          </section>

          <div className="dash-kpis">
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Pending to bill</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.pendingToBill)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">
                {cards.pendingCount} approved {cards.pendingCount === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Invoiced</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.invoiced)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              {/* Las tres tarjetas de facturado tienen otro alcance que la
                  grilla y que "Pending to bill". Sin decirlo, un filtro que
                  sólo matchea horas facturadas sin clasificar deja la grilla
                  vacía y esta tarjeta en un número, sin explicación a la vista. */}
              <span className="dash-kpi__hint">any allocation, incl. pre-triage hours</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Collected</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.collected)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">any allocation</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Pending collection</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.pendingCollection)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">any allocation</span>
            </div>
          </div>

          <div className="toolbar">
            <span className="toolbar__count">
              Ready to bill · {billableClientCount}{' '}
              {billableClientCount === 1 ? 'client' : 'clients'}
              {canCreate && billableRows.size > 0 && (
                <>
                  {' · '}
                  <button type="button" className="linklike" onClick={toggleAll}>
                    {allSelected ? 'Clear selection' : 'Select all'}
                  </button>
                </>
              )}
            </span>
            {billableRows.size > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {clientGroups.length === 0 ? (
            <div className="empty">
              {/* Se decide por `classifiable`, NO por si hay horas facturadas.
                  Que existan horas facturadas no dice nada sobre si queda algo
                  por clasificar: en producción conviven 808 h ya facturadas con
                  cientos de entries aprobadas sin clasificar, y mirar `invoiced`
                  hacía que la pantalla dijera "no hay nada que hacer" justo
                  cuando había todo por hacer.
                  El mensaje de congeladas es sólo para el caso real de que no
                  quede nada editable: esas filas tienen el checkbox
                  deshabilitado en Entries y setEntriesAllocation las rechaza, así
                  que mandar a clasificarlas termina en un control muerto. */}
              {cards.classifiable > 0
                ? can('entries.allocate')
                  ? 'No hours ready to bill. Classify approved hours as “bill to client” in Entries first.'
                  : // Billing lo ve todo el mundo, pero entries.allocate excluye
                    // a Finance: mandarlos a Entries es otra vez un control que
                    // no pueden usar, sólo que por rol en vez de por congelado.
                    'No hours ready to bill. Approved hours are waiting to be classified in Entries.'
                : cards.invoiced > 0
                  ? 'No hours ready to bill. The hours shown above are already invoiced — they stay as they were classified when billed.'
                  : 'No hours ready to bill.'}
            </div>
          ) : (
            <>
              <div className="bill-clients">
                {clientGroups.map((group) =>
                  group.isUnassigned ? (
                    // "Sin cliente": visible y arriba, pero NO facturable — sin
                    // checkboxes. Agrupa por proyecto y explica el motivo para que
                    // se pueda accionar (asignar el Project Group a un cliente).
                    <section
                      key="__unassigned__"
                      className="bill-client bill-client--unassigned"
                    >
                      <header className="bill-client__head">
                        <h3 className="bill-client__name">Sin cliente</h3>
                        <span className="bill-client__hours">{formatHours(group.hours)} h</span>
                      </header>
                      <p className="review-notice">
                        These approved hours could not be matched to a client, so they are not
                        billable yet. Assign the Zoho Project Group to a client to bill them.
                      </p>
                      <div className="table-wrap table-wrap--scroll">
                        <table className="table proj-table">
                          <thead>
                            <tr>
                              <th scope="col">Project</th>
                              <th scope="col">Reason</th>
                              <th scope="col" className="col-num">Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.projects.map((project) => (
                              <tr key={project.project || '—'}>
                                <td className="cell-strong">{project.project || '—'}</td>
                                <td className="cell-soft">{reasonLabel(project.reason)}</td>
                                <td className="col-num cell-mono">{formatHours(project.hours)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : (
                    <section key={group.client} className="bill-client">
                      <header className="bill-client__head">
                        <h3 className="bill-client__name">{group.client}</h3>
                        <span className="bill-client__hours">{formatHours(group.hours)} h</span>
                      </header>
                      {group.weeks.map((week) => {
                        const id = weekId(group.client, week)
                        const open = !collapsedWeeks.has(id)
                        return (
                          <div className="bill-week" key={id}>
                            <button
                              type="button"
                              className="bill-week__toggle"
                              onClick={() => toggleWeek(id)}
                              aria-expanded={open}
                            >
                              <span className="bill-week__chev" aria-hidden="true">
                                {open ? '▾' : '▸'}
                              </span>
                              <span className="bill-week__label">{week.week}</span>
                              <span className="bill-week__hours">
                                {formatHours(week.hours)} h · {week.rows.length}{' '}
                                {week.rows.length === 1 ? 'row' : 'rows'}
                              </span>
                            </button>
                            {open && (
                              <div className="table-wrap table-wrap--scroll">
                                <table className="table proj-table">
                                  <thead>
                                    <tr>
                                      {canCreate && (
                                        <th scope="col" style={{ width: 34 }}>
                                          <span className="sr-only">Select</span>
                                        </th>
                                      )}
                                      <th scope="col">Provider</th>
                                      <th scope="col">Project · task</th>
                                      <th scope="col" className="col-num">Hours</th>
                                      <th scope="col">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {week.rows.map((row) => {
                                      const rowId = `${group.client}||${week.weekNum ?? 'na'}||${row.key}`
                                      const sow =
                                        sowByProject.byClientAndName.get(
                                          sowKey(group.client, row.project),
                                        ) ?? sowByProject.byName.get(row.project)
                                      return (
                                        <tr key={rowId}>
                                          {canCreate && (
                                            <td>
                                              <input
                                                type="checkbox"
                                                checked={selectedKeys.has(rowId)}
                                                onChange={() => toggleGroup(rowId)}
                                                aria-label={`Select ${row.user} · ${row.project}`}
                                              />
                                            </td>
                                          )}
                                          <td className="cell-strong">{row.user}</td>
                                          <td>
                                            {row.project || '—'}
                                            {(row.task || sow) && (
                                              <div className="cell-soft">
                                                {row.task}
                                                {row.task && sow && ' · '}
                                                {sow}
                                              </div>
                                            )}
                                          </td>
                                          <td className="col-num cell-mono">
                                            {formatHours(row.hours)}
                                          </td>
                                          <td>
                                            <span className="badge badge--pending">to bill</span>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </section>
                  ),
                )}
              </div>

              {canCreate && selectedKeys.size > 0 && (
                <div className="selbar">
                  <span className="selbar__count">
                    Selected to bill: <b>{formatHours(selectedHours)} h</b> ·{' '}
                    {selectedEntries.length} {selectedEntries.length === 1 ? 'entry' : 'entries'}
                  </span>
                  <div className="selbar__action">
                    <button
                      type="button"
                      className="btn btn--pay btn--sm"
                      onClick={() => setModalOpen(true)}
                      disabled={!canBill}
                      title={
                        selectedProviders.length > 1
                          ? 'One invoice covers a single provider — narrow the selection'
                          : undefined
                      }
                    >
                      Send to billing
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSelectedKeys(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {selectedProviders.length > 1 && (
                <p className="field__error">
                  An invoice covers one provider only. Selected: {selectedProviders.join(', ')}.
                </p>
              )}
            </>
          )}
        </motion.div>
      )}

      {modalOpen && canBill && (
        <BillModal
          user={selectedProviders[0]}
          entries={selectedEntries}
          hours={selectedHours}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirmBill}
        />
      )}
    </>
  )
}
