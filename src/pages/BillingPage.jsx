import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Info } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours, formatWeek, sundayWeekYear } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { useEntryFilters, applyEntryFilters, buildFilterOptions } from '../lib/useEntryFilters'
import { deriveEntriesClient } from '../lib/entryClient'
import { groupBillToClient, groupReadonly } from '../lib/billingGrouping'
import { paidEntryIdsFrom } from '../lib/paymentsData'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'
import { BillModal } from '../components/BillModal'
import { EntryDetailDrawer } from '../components/EntryDetailDrawer'
import { BillingBadge } from '../components/BillingBadge'
import { Avatar } from '../components/Avatar'
import { ALLOCATION_LABELS } from '../lib/allocations'

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

// Un proyecto se identifica por cliente + nombre, no por nombre solo.
const sowKey = (client, projectName) => `${client ?? ''}||${projectName ?? ''}`

// Clave de una semana dentro de un cliente (para colapsar/expandir) y de una fila
// dentro de esa semana (para seleccionar/facturar). Una sola definición: el id de
// selección y la clave del índice tienen que salir de la MISMA función o divergen
// en silencio y los checkboxes dejan de matchear. week.weekId ya incluye el año
// ISO (ver billingGrouping), así que dos semanas homónimas de años distintos no
// colapsan en una.
const weekId = (client, week) => `${client}||${week.weekId}`
const rowId = (client, week, row) => `${weekId(client, week)}||${row.key}`

// Por qué una hora quedó "sin cliente" (motivo que expone clientResolver).
const REASON_LABEL = {
  'group-unclaimed': 'Project group has no client assigned',
  'no-group': 'Project has no Zoho group',
}
const reasonLabel = (reason) => REASON_LABEL[reason] ?? 'Unresolved'

// Las 4 tabs de Billing (una fila, con contador de horas). "Bill to client" es la
// facturable (con selección + factura); las otras 3 son de sólo lectura y linkean
// a Entries filtrado por su allocation para reclasificar.
// Las 4 tabs de Billing. La "X" es la allocation real 'unknown' (habilitada en el
// CHECK por la migración 0034), una 4ta categoría que se aplica a mano — NO las
// horas null sin clasificar. Sólo las horas allocation='unknown' van a la tab X.
const TABS = [
  { key: 'bill_to_client', label: 'Bill to client' },
  { key: 'overage', label: 'Overage' },
  { key: 'sp_internal', label: 'SP internal' },
  { key: 'unknown', label: 'X' },
]
const sumGroupHours = (groups) => groups.reduce((total, g) => total + g.hours, 0)

// Filas proveedor·proyecto·task para las tabs de lectura (sin checkbox ni SOW: no
// se factura acá). Se combinan por terna en groupReadonly. showProvider=false
// oculta la columna Provider cuando el grupo YA es por contractor (overage / X),
// donde repetiría el nombre del header en cada fila.
// Celda con el botón-ícono de detalle de una fila. stopPropagation en el <td>:
// un clic en el padding de la celda no debe seleccionar la fila; sólo el botón
// abre el drawer. Compartida por las filas facturables y las de sólo lectura.
function DetailButtonCell({ label, onClick }) {
  return (
    <td onClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn" onClick={onClick} aria-label={label} title="View details">
        <Info size={16} aria-hidden="true" />
      </button>
    </td>
  )
}

function ReadonlyRows({ rows, showProvider = true, onDetail }) {
  return (
    <div className="table-wrap table-wrap--scroll">
      <table className="table proj-table">
        <thead>
          <tr>
            {showProvider && <th scope="col">Provider</th>}
            <th scope="col">Project · task</th>
            <th scope="col" className="col-num">Hours</th>
            <th scope="col" style={{ width: 40 }}>
              <span className="sr-only">Detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            // row-static: estas filas no togglean selección (sólo el botón de
            // detalle actúa), así que no deben mostrar el cursor de "clickeable"
            // que .proj-table da por defecto.
            <tr key={row.key} className="row-static">
              {showProvider && (
                <td className="cell-strong">
                  <span className="cell-user">
                    <Avatar name={row.user} size="sm" />
                    {row.user}
                  </span>
                </td>
              )}
              <td>
                {row.project || '—'}
                {row.task && <div className="cell-soft">{row.task}</div>}
              </td>
              <td className="col-num cell-mono">{formatHours(row.hours)}</td>
              <DetailButtonCell
                label={`View detail for ${row.project || 'entry'}`}
                onClick={() => onDetail?.(row)}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BillingPage() {
  const { user, profile, can } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  // Pagos: para sacar de la tab Overage las horas ya pagadas (no son pendientes).
  const [payments, setPayments] = useState([])
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
  // Semanas abiertas, estado ABSOLUTO por id de semana (no un "flip" respecto de
  // una posición). Si se guardara el flip contra "la más reciente" y esa semana
  // cambia (reload, otra hora), el flip se invertiría solo y una semana con filas
  // seleccionadas podría colapsarse sin pasar por toggleWeek —dejando filas
  // ocultas pero facturables—. Con estado absoluto una semana sólo cambia por
  // toggleWeek (que poda la selección) o por el seed inicial (semana nueva, sin
  // selección todavía).
  const [openWeeks, setOpenWeeks] = useState(() => new Set())
  // Semanas ya "sembradas" con su default (la más reciente de cada cliente
  // abierta). Es un ref, no estado: sembrar no debe re-renderizar, y así un reload
  // no vuelve a aplicar el default sobre lo que el usuario ya abrió/cerró.
  const seededWeeksRef = useRef(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [notice, setNotice] = useState('')
  // Tab activa de Billing (bill_to_client | overage | sp_internal | unknown).
  const [tab, setTab] = useState('bill_to_client')
  // C9: filtro de estado de la grilla Bill to client. 'pending' (default) = sólo
  // sin facturar (la grilla facturable de siempre); 'invoiced' = sólo facturadas
  // (read-only); 'all' = ambas. Las facturadas no son seleccionables.
  const [billStatusFilter, setBillStatusFilter] = useState('pending')
  // Fila mostrada en el drawer de detalle (o null): snapshot al momento del click,
  // { entry, hours, count, periodLabel }. Una fila de Billing agrupa N entries de
  // la misma terna proveedor·proyecto·task; en las tabs con semana (overage/SP
  // internal/bill_to_client) es una semana ISO, pero la X (unknown, withWeeks:
  // false) agrega a través de semanas. Por eso se guarda `entry` (primera, para
  // los campos COMPARTIDOS: cliente/proyecto/task/allocation), las HORAS del total
  // de la fila, el conteo y una etiqueta de período derivada de las entries reales
  // (una semana, o "N weeks"). Es sólo-lectura y no edita nada, así que el snapshot
  // no necesita re-resolverse contra la data viva. Ver el render del drawer.
  const [detailRow, setDetailRow] = useState(null)
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

    Promise.all([api.timeEntries.list(), api.invoices.list(), api.clients.list(), api.payments.list()])
      .then(([entryRows, invoiceRows, clientRows, paymentRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
        setClients(clientRows)
        setPayments(paymentRows)
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

  // El desplegable Client lista TODOS los clientes del maestro, no sólo los que
  // hoy tienen horas: así un cliente sin tiempo cargado (p. ej. un grupo de Zoho
  // recién creado) sigue siendo elegible. Se une con los que aparecen en las
  // entries por si alguno resuelve a un nombre que no está en el maestro.
  const clientOptions = useMemo(
    () => sortedUnique([...options.clients, ...clients.map((c) => c.clientName)]),
    [options.clients, clients],
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

  // Tabs de sólo lectura (groupReadonly). Overage por contractor·semana, SP
  // internal por cliente·semana. Salen del mismo conjunto filtrado que la tab
  // facturable, cada una acotada a su allocation y excluyendo las ya facturadas
  // (misma base que bill_to_client). (No hay tab X — ver TABS.)
  const isInvoicedFn = useMemo(
    () => (entry) => invoiceByEntryId.has(String(entry.id)),
    [invoiceByEntryId],
  )
  // Horas de overage ya pagadas: salen de la tab Overage (no son pendientes).
  const paidEntryIds = useMemo(() => paidEntryIdsFrom(payments), [payments])
  const overageGroups = useMemo(
    () =>
      groupReadonly(
        filteredAllAllocations.filter(
          (e) => e.allocation === 'overage' && !paidEntryIds.has(String(e.id)),
        ),
        'user',
        { withWeeks: true, isInvoiced: isInvoicedFn },
      ),
    [filteredAllAllocations, isInvoicedFn, paidEntryIds],
  )
  const spInternalGroups = useMemo(
    () =>
      groupReadonly(filteredAllAllocations.filter((e) => e.allocation === 'sp_internal'), 'client', {
        withWeeks: true,
        isInvoiced: isInvoicedFn,
      }),
    [filteredAllAllocations, isInvoicedFn],
  )
  // X = allocation 'unknown' (categoría real, NO las null sin clasificar), por
  // contractor. Sólo las horas clasificadas explícitamente como X.
  const unknownGroups = useMemo(
    () =>
      groupReadonly(filteredAllAllocations.filter((e) => e.allocation === 'unknown'), 'user', {
        withWeeks: false,
        isInvoiced: isInvoicedFn,
      }),
    [filteredAllAllocations, isInvoicedFn],
  )

  useEffect(() => {
    setSelectedKeys(new Set())
    // El aviso habla de la selección anterior: dejarlo bajo otra grilla filtrada
    // haría dudar de una factura que sí se emitió.
    setNotice('')
    // También al cambiar el filtro de estado (C9): al pasar a 'invoiced' las filas
    // dejan de ser seleccionables y quedaría una barra de selección fantasma.
  }, [filters, billStatusFilter])

  // El filtro de estado (C9) sólo se ve en la tab "Bill to client"; se resetea a
  // 'pending' al cambiar de tab para no dejar la grilla filtrada en silencio al
  // volver (se vería como "no hay horas para facturar").
  useEffect(() => {
    setBillStatusFilter('pending')
  }, [tab])

  const cards = useMemo(() => {
    let pendingToBill = 0
    let pendingCount = 0
    let invoiced = 0

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

    // La tarjeta Invoiced NO filtra por allocation, a diferencia de la grilla.
    // Las facturas viejas son anteriores al triage de horas y sus entries tienen
    // allocation en null: exigirles 'bill_to_client' dejaría la tarjeta en cero
    // para siempre (808 h facturadas en la base, "Invoiced 0.0 h" en pantalla).
    // Una hora que ya se facturó está facturada, sin importar cómo se la haya
    // clasificado después.
    for (const entry of filteredAllAllocations) {
      if (!invoiceByEntryId.has(String(entry.id))) continue
      invoiced += Number(entry.hours) || 0
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
        billingStatusOf: (entry) => invoiceByEntryId.get(String(entry.id))?.status ?? null,
        statusFilter: billStatusFilter,
      }),
    [filtered, invoiceByEntryId, billStatusFilter],
  )
  // Clientes MOSTRADOS en la grilla (según el filtro de estado) — para el toolbar.
  const shownClientCount = useMemo(
    () => clientGroups.filter((g) => !g.isUnassigned).length,
    [clientGroups],
  )

  // Tarjetas (No client / Clients to bill): resumen de lo PENDIENTE (aprobado,
  // bill_to_client, sin facturar), calculado directo de `filtered` en una sola
  // pasada. No dependen del filtro de estado de la grilla (que puede mostrar
  // facturadas) ni requieren un segundo grouping.
  const { billableClientCount, sinClienteHours } = useMemo(() => {
    const clients = new Set()
    let unassignedHours = 0
    for (const e of filtered) {
      if (e.status !== 'Approved') continue
      if (invoiceByEntryId.has(String(e.id))) continue
      const client = e.client || ''
      if (client === '') unassignedHours += Number(e.hours) || 0
      else clients.add(client)
    }
    return { billableClientCount: clients.size, sinClienteHours: unassignedHours }
  }, [filtered, invoiceByEntryId])

  // Horas pendientes de facturar por cliente+contractor, sobre TODAS las entries
  // (NO las filtradas). El aviso del modal tiene que reflejar lo que realmente le
  // queda al contractor en ese cliente, no lo que el filtro de Proyecto/fecha deja
  // ver: si no, filtrar por un proyecto haría creer que no queda nada pendiente
  // cuando el contractor sí tiene horas sin facturar en otro proyecto del cliente.
  const pendingByClientProvider = useMemo(() => {
    const m = new Map()
    for (const e of entriesConCliente) {
      if (e.status !== 'Approved') continue
      if (e.allocation !== 'bill_to_client') continue
      if (!e.client) continue
      if (invoiceByEntryId.has(String(e.id))) continue
      const key = `${e.client}||${e.user}`
      m.set(key, (m.get(key) ?? 0) + (Number(e.hours) || 0))
    }
    return m
  }, [entriesConCliente, invoiceByEntryId])

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
          // Las filas facturadas (C9, filtro invoiced/all) son read-only: no entran
          // al índice de selección ni pueden re-facturarse.
          if (row.invoiced) continue
          const id = rowId(group.client, week, row)
          map.set(id, { ...row, rowId: id, client: group.client, week: week.week })
        }
      }
    }
    return map
  }, [clientGroups])

  // Siembra el default de colapso: la semana más reciente de cada cliente (i===0)
  // arranca abierta; el resto colapsadas. Sólo se siembra una semana la PRIMERA
  // vez que aparece (seededWeeksRef), así un reload no pisa lo que el usuario
  // abrió/cerró a mano.
  useEffect(() => {
    if (!seededWeeksRef.current) seededWeeksRef.current = new Set()
    const seeded = seededWeeksRef.current
    // La lectura/mutación del ref va en el CUERPO del efecto, no en el updater:
    // bajo StrictMode el updater se invoca dos veces con el mismo `prev`, y si
    // sembrara ahí, la 2da pasada vería el wid ya sembrado y no abriría la semana.
    const toOpen = []
    for (const group of clientGroups) {
      if (group.isUnassigned) continue
      group.weeks.forEach((week, i) => {
        const wid = weekId(group.client, week)
        if (seeded.has(wid)) return
        seeded.add(wid)
        if (i === 0) toOpen.push(wid)
      })
    }
    if (toOpen.length) {
      setOpenWeeks((prev) => {
        const next = new Set(prev)
        for (const wid of toOpen) next.add(wid)
        return next
      })
    }
  }, [clientGroups])

  const selectedRows = [...selectedKeys].map((k) => billableRows.get(k)).filter(Boolean)
  const selectedEntries = selectedRows.flatMap((r) => r.entries)
  const selectedHours = selectedRows.reduce((sum, r) => sum + r.hours, 0)
  const selectedProviders = sortedUnique(selectedRows.map((r) => r.user))
  const canCreate = can('billing.create')
  const canBill = canCreate && selectedEntries.length > 0 && selectedProviders.length === 1

  // Horas del contractor que quedan pendientes en el cliente de la selección y NO
  // entran en esta factura (C11). Sólo se calcula con el modal abierto (no en cada
  // render) y sólo cuando la selección es de UN cliente: con varios, la resta
  // cruzaría clientes y el número sería ambiguo (no se sabría de cuál son las
  // horas restantes), así que en ese caso no se muestra aviso.
  const remainingHoursForInvoice = (() => {
    if (!modalOpen || !canBill) return 0
    const selClients = new Set(selectedRows.map((r) => r.client))
    if (selClients.size !== 1) return 0
    const [client] = selClients
    const pending = pendingByClientProvider.get(`${client}||${selectedProviders[0]}`) ?? 0
    return Math.max(0, pending - selectedHours)
  })()

  function toggleGroup(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Abre el drawer de detalle para una fila (ver detailRow). El período sale de
  // las semanas ISO reales de las sub-entries: una sola → esa semana ("W32 · 2025",
  // igual que el header de la grilla); varias (caso X, que agrega cross-week) →
  // "N weeks". La dedup lleva el AÑO en la clave: dos años con el mismo número de
  // semana ISO son semanas distintas (mismo criterio que weekId en billingGrouping),
  // si no una fila W10-2025 + W10-2026 se etiquetaría como una sola semana.
  function openRowDetail(row) {
    const entries = row?.entries ?? []
    const entry = entries[0]
    if (!entry) return
    const seen = new Set()
    const labels = []
    for (const e of entries) {
      if (!e.date) continue
      const key = `${sundayWeekYear(e.date)}-${formatWeek(e.date)}`
      if (seen.has(key)) continue
      seen.add(key)
      labels.push(`${formatWeek(e.date)} · ${sundayWeekYear(e.date)}`)
    }
    const periodLabel =
      labels.length === 1 ? labels[0] : labels.length === 0 ? '—' : `${labels.length} weeks`
    // billStatus: estado de billing de la fila (bill_to_client). Para las filas de
    // las tabs de lectura (overage/SP/X) no aplica y queda null.
    setDetailRow({
      entry,
      hours: row.hours,
      count: entries.length,
      periodLabel,
      billStatus: row.billStatus ?? null,
    })
  }

  function toggleWeek(id) {
    const isOpen = openWeeks.has(id)
    setOpenWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // Al colapsar (estaba abierta), se sacan de la selección las filas de esa
    // semana: si quedaran seleccionadas pero ocultas, se podría facturar horas
    // que ya no se ven.
    if (isOpen) {
      setSelectedKeys((prev) => new Set([...prev].filter((k) => !k.startsWith(`${id}||`))))
    }
  }

  // "Select all" acotado a UNA semana (las filas visibles de esa semana): un
  // bulk-select que no toca semanas colapsadas ni oculta lo que se factura.
  function toggleWeekSelection(weekRowIds, allSelected) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const id of weekRowIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
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
      { header: 'Reason', key: 'reason' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
      // Status distingue pendientes de facturadas (C9): sin esta columna, exportar
      // con el filtro 'invoiced'/'all' presentaría horas ya facturadas como
      // "ready to bill" (riesgo de doble facturación).
      { header: 'Status', key: 'status' },
    ]
    // Se exporta lo mismo que muestra la grilla: las filas facturables por cliente
    // y también el bucket "Sin cliente" (con el motivo), que son justo las horas
    // que alguien exporta para ir a resolver el mapeo de grupo en Zoho.
    const rows = []
    for (const group of clientGroups) {
      if (group.isUnassigned) {
        for (const project of group.projects) {
          rows.push({
            provider: '',
            client: 'Sin cliente',
            week: '—',
            project: project.project,
            task: '',
            reason: reasonLabel(project.reason),
            hours: project.hours,
            entries: project.entries.length,
            status: 'Pending',
          })
        }
      } else {
        for (const week of group.weeks) {
          for (const row of week.rows) {
            rows.push({
              provider: row.user,
              client: group.client,
              week: week.week,
              project: row.project,
              task: row.task,
              reason: '',
              hours: row.hours,
              entries: row.entries.length,
              status: row.billStatus,
            })
          }
        }
      }
    }
    const scope =
      billStatusFilter === 'invoiced' ? 'invoiced' : billStatusFilter === 'all' ? 'all' : 'ready to bill'
    exportGrid({
      rows,
      columns: cols,
      title: `Billing · ${scope}`,
      gridName: `billing-${scope.replace(/\s+/g, '-')}`,
      format,
      generatedBy: user?.email ?? '',
    })
  }

  // Export de una tab de sólo lectura (Overage / SP internal / X). Aplana los
  // grupos igual que los muestra la grilla (entidad → semana → filas, o entidad →
  // filas cuando no hay semana, como en la X). La columna Provider sólo va cuando
  // la entidad NO es ya el contractor (sp_internal), para no repetirla.
  function handleExportReadonly(format, groups, { entityLabel, allocation, showProvider }) {
    const cols = [
      { header: entityLabel === 'client' ? 'Client' : 'Contractor', key: 'entity' },
      ...(showProvider ? [{ header: 'Provider', key: 'provider' }] : []),
      { header: 'Week', key: 'week' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
    ]
    const rows = []
    const push = (group, week, row) =>
      rows.push({
        entity: group.entity || '—',
        ...(showProvider ? { provider: row.user || '' } : {}),
        week: week ? week.week : '—',
        project: row.project || '',
        task: row.task || '',
        hours: row.hours,
        entries: row.entries.length,
      })
    for (const group of groups) {
      if (group.weeks) {
        for (const week of group.weeks) for (const row of week.rows) push(group, week, row)
      } else {
        for (const row of group.rows) push(group, null, row)
      }
    }
    exportGrid({
      rows,
      columns: cols,
      title: `Billing · ${allocation}`,
      gridName: `billing-${allocation}`,
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
    // La factura saca esas filas de billableRows; sin limpiar la selección, la
    // barra de selección quedaría con ids muertos ("0.0 h · 0 entries").
    setSelectedKeys(new Set())
    // Se relee en vez de parchear: la factura nueva cambia las 4 tarjetas y saca
    // las filas de la grilla, y esos números no se pueden inventar localmente.
    setReloadKey((k) => k + 1)
  }

  // Link a Entries llevando los filtros activos de Billing (cliente/proyecto/
  // contractor) además de la allocation, para reclasificar sobre el mismo recorte.
  // Nota: Entries muestra esas horas SIN el recorte de la tab (que es sólo Approved
  // y no facturadas), así que puede incluir también Pending/Rejected/facturadas de
  // esa allocation — a propósito: para reclasificar conviene ver todas, no sólo las
  // que la tab lista.
  function entriesLinkTo(allocation) {
    const params = new URLSearchParams()
    filters.clients.forEach((c) => params.append('client', c))
    filters.projects.forEach((p) => params.append('project', p))
    filters.contractors.forEach((c) => params.append('contractor', c))
    params.append('allocation', allocation)
    return `/entries?${params.toString()}`
  }

  // Render de una tab de sólo lectura (Overage / SP internal / X): toolbar con
  // contador + link a Entries filtrado, y las entidades con sus filas. La forma
  // (con o sin semana) se INFIERE de cada grupo (group.weeks vs group.rows), no se
  // pasa aparte: así no puede desincronizarse con cómo se construyó el grupo.
  // showProvider oculta la columna Provider cuando el grupo YA es por contractor
  // (overage / X), donde repetiría el nombre del header en cada fila.
  function renderReadonlyTab(groups, { entityLabel, allocation, emptyLabel, showProvider = true }) {
    return (
      <>
        <div className="toolbar">
          <span className="toolbar__count">
            {groups.length} {entityLabel}
            {groups.length === 1 ? '' : 's'} · {formatHours(sumGroupHours(groups))} h
          </span>
          <div className="toolbar__actions">
            {groups.length > 0 && (
              <ExportDropdown
                onExport={(format) =>
                  handleExportReadonly(format, groups, { entityLabel, allocation, showProvider })
                }
              />
            )}
            <Link className="btn btn--ghost btn--sm" to={entriesLinkTo(allocation)}>
              View in Entries <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
        {groups.length === 0 ? (
          <div className="empty">No {emptyLabel} hours under the current filters.</div>
        ) : (
          <div className="bill-clients">
            {groups.map((group) => (
              <section key={group.entity || '__none__'} className="bill-client">
                <header className="bill-client__head">
                  <h3 className="bill-client__name">{group.entity || '—'}</h3>
                  <span className="bill-client__hours">{formatHours(group.hours)} h</span>
                </header>
                {group.weeks ? (
                  group.weeks.map((week) => (
                    <div className="bill-week" key={week.weekId}>
                      <div className="bill-week__static">
                        <span className="bill-week__label">{week.week}</span>
                        <span className="bill-week__hours">{formatHours(week.hours)} h</span>
                      </div>
                      <ReadonlyRows rows={week.rows} showProvider={showProvider} onDetail={openRowDetail} />
                    </div>
                  ))
                ) : (
                  <ReadonlyRows rows={group.rows} showProvider={showProvider} onDetail={openRowDetail} />
                )}
              </section>
            ))}
          </div>
        )}
      </>
    )
  }

  // Horas por tab para el contador de la fila de tabs (una vez por render).
  const hoursByTab = {
    bill_to_client: cards.pendingToBill,
    overage: sumGroupHours(overageGroups),
    sp_internal: sumGroupHours(spInternalGroups),
    unknown: sumGroupHours(unknownGroups),
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
                options={clientOptions}
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
            <div className="dash-kpi dash-kpi--static dash-kpi--accent">
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
                <span className="dash-kpi__label">No client</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(sinClienteHours)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">bill-to-client with no resolved client</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Invoiced</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.invoiced)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              {/* La tarjeta de facturado tiene otro alcance que la grilla y que
                  "Pending to bill": cuenta cualquier allocation, incluidas las
                  horas pre-triage (facturas viejas con allocation en null). */}
              <span className="dash-kpi__hint">any allocation, incl. pre-triage hours</span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Clients to bill</span>
              </div>
              <span className="dash-kpi__value">{billableClientCount}</span>
              <span className="dash-kpi__hint">
                {billableClientCount === 1 ? 'client with' : 'clients with'} pending hours
              </span>
            </div>
          </div>

          {/* Botones planos con aria-pressed en vez del patrón ARIA tablist/tab:
              un tablist "a medias" (sin tabpanel/aria-controls ni navegación por
              flechas) confunde más a los lectores que botones toggle claros. */}
          <div className="bill-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                className={`bill-tab${tab === t.key ? ' bill-tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="bill-tab__count">{formatHours(hoursByTab[t.key] ?? 0)} h</span>
              </button>
            ))}
          </div>

          {tab === 'bill_to_client' && (
            <>
              <div className="toolbar">
                <span className="toolbar__count">
                  {billStatusFilter === 'invoiced'
                    ? 'Invoiced'
                    : billStatusFilter === 'all'
                      ? 'All'
                      : 'Ready to bill'}{' '}
                  · {shownClientCount} {shownClientCount === 1 ? 'client' : 'clients'}
                </span>
                <div className="toolbar__actions">
                  <select
                    className="field__input"
                    style={{ width: 'auto', height: 38 }}
                    value={billStatusFilter}
                    onChange={(e) => setBillStatusFilter(e.target.value)}
                    aria-label="Filter by billing status"
                  >
                    <option value="pending">Pending</option>
                    <option value="invoiced">Invoiced</option>
                    <option value="all">All</option>
                  </select>
                  {clientGroups.length > 0 && <ExportDropdown onExport={handleExport} />}
                </div>
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
              {billStatusFilter === 'invoiced'
                ? 'No invoiced bill-to-client hours under the current filters. (The Invoiced card above counts every allocation, including pre-triage hours.)'
                : billStatusFilter === 'all'
                  ? 'No bill-to-client hours (pending or invoiced) under the current filters.'
                : cards.classifiable > 0
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
                              // Prefijo constante: los nombres son únicos en el
                              // bucket (agrupa por nombre), así que "proj:"+nombre
                              // nunca colisiona —el vacío queda "proj:" y ningún
                              // proyecto real puede tener ese nombre—.
                              <tr key={`proj:${project.project}`}>
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
                        const wid = weekId(group.client, week)
                        // Estado absoluto: abierta sólo si está en openWeeks (el
                        // seed abrió la más reciente de cada cliente).
                        const open = openWeeks.has(wid)
                        // Sólo las filas pendientes son seleccionables (las
                        // facturadas van read-only con el filtro invoiced/all).
                        const weekRowIds = week.rows
                          .filter((row) => !row.invoiced)
                          .map((row) => rowId(group.client, week, row))
                        const allWeekSelected =
                          weekRowIds.length > 0 && weekRowIds.every((k) => selectedKeys.has(k))
                        return (
                          <div className="bill-week" key={wid}>
                            <button
                              type="button"
                              className="bill-week__toggle"
                              onClick={() => toggleWeek(wid)}
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
                                      {canCreate && weekRowIds.length > 0 && (
                                        <th scope="col" style={{ width: 34 }}>
                                          <input
                                            type="checkbox"
                                            checked={allWeekSelected}
                                            onChange={() =>
                                              toggleWeekSelection(weekRowIds, allWeekSelected)
                                            }
                                            aria-label={`Select all rows in ${week.week}`}
                                          />
                                        </th>
                                      )}
                                      <th scope="col">Provider</th>
                                      <th scope="col">Project · task</th>
                                      <th scope="col" className="col-num">Hours</th>
                                      <th scope="col">Status</th>
                                      <th scope="col" style={{ width: 40 }}>
                                        <span className="sr-only">Detail</span>
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {week.rows.map((row) => {
                                      const id = rowId(group.client, week, row)
                                      const sow =
                                        sowByProject.byClientAndName.get(
                                          sowKey(group.client, row.project),
                                        ) ?? sowByProject.byName.get(row.project)
                                      // Fila seleccionable sólo si es pendiente; las facturadas
                                      // (filtro invoiced/all) van read-only. row.billStatus
                                      // (resuelto en la capa de grouping) lo usan el badge, el
                                      // drawer y el export.
                                      const selectable = canCreate && !row.invoiced
                                      return (
                                        <tr
                                          key={id}
                                          // Sin billing.create (o fila facturada) no togglea (no
                                          // hay onClick): row-static evita el cursor de
                                          // "clickeable" que da .proj-table.
                                          className={
                                            !selectable
                                              ? 'row-static'
                                              : selectedKeys.has(id)
                                                ? 'is-selected'
                                                : undefined
                                          }
                                          onClick={
                                            selectable
                                              ? (e) => {
                                                  // No robar el click cuando el usuario está
                                                  // seleccionando texto DENTRO de esta fila
                                                  // (drag-select); una selección vieja en otra
                                                  // parte de la página no debe anular el toggle.
                                                  const sel = window.getSelection?.()
                                                  if (
                                                    sel &&
                                                    !sel.isCollapsed &&
                                                    e.currentTarget.contains(sel.anchorNode)
                                                  )
                                                    return
                                                  toggleGroup(id)
                                                }
                                              : undefined
                                          }
                                        >
                                          {canCreate && weekRowIds.length > 0 && (
                                            // La columna del checkbox existe si la semana tiene
                                            // filas seleccionables; una fila facturada deja la
                                            // celda vacía para no desalinear las columnas.
                                            // stopPropagation: el checkbox ya togglea por su
                                            // onChange; sin esto el click burbujea al <tr>.
                                            <td onClick={(e) => e.stopPropagation()}>
                                              {selectable && (
                                                <input
                                                  type="checkbox"
                                                  checked={selectedKeys.has(id)}
                                                  onChange={() => toggleGroup(id)}
                                                  aria-label={`Select ${row.user} · ${row.project}`}
                                                />
                                              )}
                                            </td>
                                          )}
                                          <td className="cell-strong">
                                            <span className="cell-user">
                                              <Avatar name={row.user} size="sm" />
                                              {row.user}
                                            </span>
                                          </td>
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
                                            {row.invoiced ? (
                                              <BillingBadge status={row.billStatus} />
                                            ) : (
                                              <span className="badge badge--pending">to bill</span>
                                            )}
                                          </td>
                                          <DetailButtonCell
                                            label={`View detail for ${row.user} · ${row.project}`}
                                            onClick={() => openRowDetail(row)}
                                          />
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
                <div className="selbar selbar--active">
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
            </>
          )}

          {tab === 'overage' &&
            renderReadonlyTab(overageGroups, {
              entityLabel: 'contractor',
              allocation: 'overage',
              emptyLabel: 'overage',
              showProvider: false,
            })}
          {tab === 'sp_internal' &&
            renderReadonlyTab(spInternalGroups, {
              entityLabel: 'client',
              allocation: 'sp_internal',
              emptyLabel: 'SP internal',
            })}
          {tab === 'unknown' &&
            renderReadonlyTab(unknownGroups, {
              entityLabel: 'contractor',
              allocation: 'unknown',
              emptyLabel: 'X',
              showProvider: false,
            })}
        </motion.div>
      )}

      {modalOpen && canBill && (
        <BillModal
          user={selectedProviders[0]}
          entries={selectedEntries}
          hours={selectedHours}
          remainingHours={remainingHoursForInvoice}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirmBill}
        />
      )}

      {detailRow && (() => {
        // Horas = total de la fila (no las de una sub-entry): es el número que
        // importa al facturar. En filas multi-entry la nota de una sola sub-entry
        // no representa la fila (se omite); el drawer muestra conteo + período en
        // vez de la fecha de una sola. Fila de una sola entry → pasa igual.
        const aggregate = detailRow.count > 1
        const entry = aggregate
          ? { ...detailRow.entry, hours: detailRow.hours, description: '', notes: '' }
          : detailRow.entry
        // Billing sólo aplica a lo facturable al cliente. Con el filtro de estado
        // (C9) la grilla puede mostrar filas facturadas, así que se usa el
        // billStatus real de la fila (Pending para pendientes; Invoiced/Collected/
        // Paid para facturadas). Para overage / SP internal / X (nunca se facturan
        // al cliente) queda null y el drawer oculta el dato.
        const billingStatus =
          entry.allocation === 'bill_to_client' ? detailRow.billStatus ?? 'Pending' : null
        return (
          <EntryDetailDrawer
            entry={entry}
            allocationLabel={entry.allocation ? ALLOCATION_LABELS[entry.allocation] : null}
            billingStatus={billingStatus}
            entryCount={detailRow.count}
            periodLabel={aggregate ? detailRow.periodLabel : null}
            onClose={() => setDetailRow(null)}
          />
        )
      })()}
    </>
  )
}
