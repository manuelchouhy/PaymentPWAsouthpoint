import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { useEntryFilters, applyEntryFilters } from '../lib/useEntryFilters'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'
import { BillModal } from '../components/BillModal'

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

// Una factura al cliente cubre horas de UN proveedor (misma regla que la
// pantalla de Time Entries): el número de factura y el monto son del proveedor.
const groupKey = (entry) => `${entry.user}||${entry.project ?? ''}||${entry.task ?? ''}`

// Un proyecto se identifica por cliente + nombre, no por nombre solo.
const sowKey = (client, projectName) => `${client ?? ''}||${projectName ?? ''}`

export function BillingPage() {
  const { user, profile, can } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [sowByProject, setSowByProject] = useState(() => ({
    byClientAndName: new Map(),
    byName: new Map(),
  }))
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
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
      })
      .catch((error) => console.error('No se pudieron cargar los SOW de Billing:', error))

    Promise.all([api.timeEntries.list(), api.invoices.list()])
      .then(([entryRows, invoiceRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
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

  // Las opciones de los dropdowns salen de TODAS las entries, no sólo de las
  // bill_to_client: las tarjetas de facturado cuentan sobre todas, así que un
  // cliente cuyas horas están todas sin clasificar aporta a "Invoiced" pero no
  // aparecería en la lista.
  //
  // LIMITACIÓN que esto NO arregla: sortedUnique descarta los valores vacíos y
  // rowToEntry normaliza client/project null a ''. Una entry sin cliente cuenta
  // en las tarjetas pero no la alcanza ningún filtro, así que tildar todos los
  // clientes puede dar MENOS que no tildar ninguno. No es teórico: hoy en
  // producción 550 de 559 entries tienen client vacío. Arreglarlo pide una
  // opción explícita tipo "—" en MultiSelectDropdown, que es compartido por
  // varias pantallas: va en su propio slice.
  const options = useMemo(
    () => ({
      contractors: sortedUnique(entries.map((e) => e.user)),
      clients: sortedUnique(entries.map((e) => e.client)),
      projects: sortedUnique(entries.map((e) => e.project)),
    }),
    [entries],
  )

  // Todas las filas que pasan los filtros del usuario, sin mirar allocation.
  const filteredAllAllocations = useMemo(
    () => applyEntryFilters(entries, filters, invoiceByEntryId),
    [entries, filters, invoiceByEntryId],
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

    return { pendingToBill, pendingCount, invoiced, collected, pendingCollection: invoiced - collected }
  }, [filtered, filteredAllAllocations, invoiceByEntryId])

  // La grilla agrupa por proveedor · proyecto · task, como el prototipo: nadie
  // factura hora por hora, se factura "el backend de tal SOW".
  const groups = useMemo(() => {
    const byKey = new Map()
    for (const entry of filtered) {
      if (entry.status !== 'Approved') continue
      if (invoiceByEntryId.has(String(entry.id))) continue
      const key = groupKey(entry)
      const group = byKey.get(key)
      if (group) {
        group.hours += Number(entry.hours) || 0
        group.entries.push(entry)
      } else {
        byKey.set(key, {
          key,
          user: entry.user,
          project: entry.project ?? '',
          task: entry.task ?? '',
          client: entry.client ?? '',
          hours: Number(entry.hours) || 0,
          entries: [entry],
        })
      }
    }
    return [...byKey.values()].sort(
      (a, b) => a.user.localeCompare(b.user, 'es') || b.hours - a.hours,
    )
  }, [filtered, invoiceByEntryId])

  const selectedGroups = groups.filter((g) => selectedKeys.has(g.key))
  const selectedEntries = selectedGroups.flatMap((g) => g.entries)
  const selectedHours = selectedGroups.reduce((sum, g) => sum + g.hours, 0)
  const selectedProviders = sortedUnique(selectedGroups.map((g) => g.user))
  const allSelected = groups.length > 0 && groups.every((g) => selectedKeys.has(g.key))
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
    setSelectedKeys(allSelected ? new Set() : new Set(groups.map((g) => g.key)))
  }

  function handleExport(format) {
    const cols = [
      { header: 'Provider', key: 'provider' },
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
    ]
    const rows = groups.map((g) => ({
      provider: g.user,
      client: g.client,
      project: g.project,
      task: g.task,
      hours: g.hours,
      entries: g.entries.length,
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
              Ready to bill · {groups.length} {groups.length === 1 ? 'group' : 'groups'}
            </span>
            {groups.length > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {groups.length === 0 ? (
            <div className="empty">
              {/* Si lo que hay bajo el filtro actual ya está facturado, mandar a
                  clasificar es un consejo imposible: esas filas están congeladas
                  —checkbox deshabilitado en Entries y rechazo en
                  setEntriesAllocation— así que el usuario iría a un control que
                  no se puede tocar. */}
              {cards.invoiced > 0
                ? 'No hours ready to bill. The hours shown above are already invoiced — they stay as they were classified when billed.'
                : 'No hours ready to bill. Classify approved hours as “bill to client” in Entries first.'}
            </div>
          ) : (
            <>
              <div className="table-wrap table-wrap--scroll">
                <table className="table proj-table">
                  <thead>
                    <tr>
                      {canCreate && (
                        <th scope="col" style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            aria-label="Select all groups"
                          />
                        </th>
                      )}
                      <th scope="col">Provider</th>
                      <th scope="col">Project · task</th>
                      <th scope="col">Client</th>
                      <th scope="col" className="col-num">Hours</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.key}>
                        {canCreate && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(group.key)}
                              onChange={() => toggleGroup(group.key)}
                              aria-label={`Select ${group.user} · ${group.project}`}
                            />
                          </td>
                        )}
                        <td className="cell-strong">{group.user}</td>
                        <td>
                          {group.project || '—'}
                          {(() => {
                            const sow =
                              sowByProject.byClientAndName.get(
                                sowKey(group.client, group.project),
                              ) ?? sowByProject.byName.get(group.project)
                            if (!group.task && !sow) return null
                            return (
                              <div className="cell-soft">
                                {group.task}
                                {group.task && sow && ' · '}
                                {sow}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="cell-soft">{group.client || '—'}</td>
                        <td className="col-num cell-mono">{formatHours(group.hours)}</td>
                        <td>
                          <span className="badge badge--pending">to bill</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
