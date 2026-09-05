import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Info } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate, formatHours, weekStartISO } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { useEntryFilters, applyEntryFilters, buildFilterOptions, sortedUnique, clientFilterOptions, OTHER_CLIENT } from '../lib/useEntryFilters'
import { deriveEntriesClient } from '../lib/entryClient'
import { buildClientResolver } from '../lib/clientResolver'
import { groupBillToClient, groupReadonly } from '../lib/billingGrouping'
import {
  canBillSelection,
  billBlockReason,
  contractorsFromSelection,
  remainingHoursByContractor,
  weekStartFromSelection,
  selectionScope,
} from '../lib/billingSelection'
import { paidEntryIdsFrom } from '../lib/paymentsData'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { Checkbox } from '../components/Checkbox'
import { ExportDropdown } from '../components/ExportDropdown'
import { GroupedBillModal } from '../components/GroupedBillModal'
import { EntryDetailDrawer } from '../components/EntryDetailDrawer'
import { BillingBadge } from '../components/BillingBadge'
import { Avatar } from '../components/Avatar'
import { ALLOCATION_LABELS } from '../lib/allocations'

// Un proyecto se identifica por cliente + nombre, no por nombre solo.
const sowKey = (client, projectName) => `${client ?? ''}||${projectName ?? ''}`

// Texto del aviso "no se puede emitir", según el motivo (billBlockReason). Se usa
// TANTO en el <p> de error como en el title del botón, así no se contradicen.
function billBlockMessage(reason, selectedRows) {
  switch (reason) {
    case 'multi-client':
      return `An invoice covers a single client. Selected: ${sortedUnique(selectedRows.map((r) => r.client)).join(', ')}.`
    case 'multi-project':
      return `An invoice covers a single project of one client. Selected projects: ${sortedUnique(selectedRows.map((r) => r.project || '(no project)')).join(', ')}.`
    case 'no-client':
      return 'These hours have no client resolved. Fix the client before billing them.'
    case 'no-project':
      return 'These hours have no project. Assign a project before billing them.'
    case 'no-contractor':
      return 'Some selected hours have no contractor.'
    case 'multi-week':
      return 'An invoice covers a single week (Sun–Sat). Narrow the selection to one week.'
    case 'no-week':
      return 'These hours have no date to place them in a billing week.'
    default:
      return ''
  }
}

// Claves anidadas cliente → proyecto → semana → fila (para colapsar/expandir y
// seleccionar/facturar). Una sola definición: el id de selección y la clave del
// índice salen de la MISMA función o divergen en silencio y los checkboxes dejan de
// matchear. Los prefijos ANIDAN (projectId ⊂ weekId ⊂ rowId) para que al colapsar un
// proyecto/semana se puedan sacar sus filas de la selección con startsWith.
//
// El proyecto va SÍ o SÍ en la clave: dos proyectos del mismo cliente pueden tener
// horas en la misma semana calendario (mismo week.weekId), y sin el proyecto sus
// semanas/filas colisionarían (se pisaría la selección y el colapso). week.weekId ya
// incluye el año (semana domingo→sábado, ver billingGrouping).
// Los segmentos de texto libre (cliente, nombre de proyecto) se ENCODEAN: sin esto,
// como la selección se poda por prefijo `id||` (ver toggleCollapse), un proyecto
// llamado "P|" generaría "cliente||P%7C||…" que —sin encodear— colisionaría con el
// prefijo del proyecto "P" ("cliente||P||…") y podaría filas del proyecto equivocado.
// week.weekId ("año-semana") y row.key van al final y no rompen el prefijo.
const enc = (s) => encodeURIComponent(s ?? '')
const projectId = (client, project) => `${enc(client)}||${enc(project.project)}`
const weekId = (client, project, week) => `${projectId(client, project)}||${week.weekId}`
const rowId = (client, project, week, row) => `${weekId(client, project, week)}||${row.key}`

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
            <th scope="col">Date</th>
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
              <td className="cell-mono">{row.date ? formatDate(row.date) : '—'}</td>
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
  // Colapso del nivel proyecto (mismo modelo absoluto que openWeeks): un proyecto
  // sólo cambia por toggleProject (que poda su selección) o por el seed inicial.
  const [openProjects, setOpenProjects] = useState(() => new Set())
  const seededProjectsRef = useRef(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [notice, setNotice] = useState('')
  // Tab activa de Billing (bill_to_client | overage | sp_internal | unknown).
  const [tab, setTab] = useState('bill_to_client')
  // C9: filtro de estado de la grilla Bill to client. 'pending' (default) = sólo
  // sin facturar (la grilla facturable de siempre); 'invoiced' = sólo facturadas
  // (read-only); 'all' = ambas. Las facturadas no son seleccionables.
  const [billStatusFilter, setBillStatusFilter] = useState('pending')
  // Fila mostrada en el drawer de detalle (o null): snapshot al momento del click,
  // { entry, billStatus }. Cada fila de la grilla es UN log individual (groupRows
  // emite una fila por hora), así que el snapshot guarda esa entry y el billStatus
  // de la fila. Es sólo-lectura y no edita nada, así que no necesita re-resolverse
  // contra la data viva. Ver el render del drawer.
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

  // Resolver maestro proyecto→cliente (id/grupo/legacy), el MISMO que canonicaliza
  // el cliente de la grilla. El modal agrupado lo usa para matchear sus avisos de
  // contrato por cliente maestro y no por projects.client crudo. Ver clientResolver.js.
  const resolveClient = useMemo(() => buildClientResolver(clients), [clients])

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
  // Nombres del maestro (los mismos que la página Clients): con este Set el
  // filtro de Cliente agrupa bajo "Others" a los clientes que no están en él.
  const masterNames = useMemo(
    () => new Set(clients.map((c) => c.clientName).filter(Boolean)),
    [clients],
  )

  const options = useMemo(
    () => buildFilterOptions(entriesConCliente, filters, invoiceByEntryId, masterNames),
    [entriesConCliente, filters, invoiceByEntryId, masterNames],
  )

  // El desplegable Client lista SÓLO los clientes del maestro (mismos que la
  // página Clients), no los nombres legacy sueltos; las horas que resuelven a un
  // cliente fuera del maestro —o sin cliente— se agrupan bajo el centinela Others.
  // Mismo criterio que Entries y Projects. Que Others aparezca se decide sobre lo
  // scoped (options.clients, cruzado con los otros filtros). (El agrupado bill-to y
  // la columna siguen mostrando el nombre real.)
  const clientOptions = useMemo(
    () => clientFilterOptions(clients, options.clients.includes(OTHER_CLIENT)),
    [clients, options.clients],
  )

  // Todas las filas que pasan los filtros del usuario, sin mirar allocation.
  const filteredAllAllocations = useMemo(
    () => applyEntryFilters(entriesConCliente, filters, invoiceByEntryId, masterNames),
    [entriesConCliente, filters, invoiceByEntryId, masterNames],
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
  // Horas invoice-less ya pagadas (overage y sp_internal): salen de su tab en
  // Billing — ya se le pagaron al contractor desde Payments, no son pendientes.
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
      groupReadonly(
        filteredAllAllocations.filter(
          (e) => e.allocation === 'sp_internal' && !paidEntryIds.has(String(e.id)),
        ),
        'client',
        { withWeeks: true, isInvoiced: isInvoicedFn },
      ),
    [filteredAllAllocations, isInvoicedFn, paidEntryIds],
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

  // Las horas facturables ordenadas por cliente → semana domingo→sábado → filas
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
  // Pendiente facturable por UNIDAD (cliente + proyecto + semana) y contractor: es
  // la base del aviso "remaining" del modal, que debe medirse en la misma unidad
  // que la factura (no en todo el cliente). Clave `client||project||weekStart||user`.
  const pendingByUnitUser = useMemo(() => {
    const m = new Map()
    for (const e of entriesConCliente) {
      if (e.status !== 'Approved') continue
      if (e.allocation !== 'bill_to_client') continue
      if (!e.client) continue
      if (invoiceByEntryId.has(String(e.id))) continue
      const ws = weekStartISO(e.date ?? '') ?? ''
      const key = `${e.client}||${e.project ?? ''}||${ws}||${e.user}`
      m.set(key, (m.get(key) ?? 0) + (Number(e.hours) || 0))
    }
    return m
  }, [entriesConCliente, invoiceByEntryId])

  // Índice de filas facturables por clave única (cliente·semana·log). La selección
  // y la factura trabajan a nivel de fila, y cada fila es un log individual (una
  // hora), así que se factura hora por hora; una factura cubre UN proveedor. El
  // bucket "Sin cliente" no entra: no se factura.
  const billableRows = useMemo(() => {
    const map = new Map()
    for (const group of clientGroups) {
      if (group.isUnassigned) continue
      for (const project of group.projects) {
        for (const week of project.weeks) {
          for (const row of week.rows) {
            // Las filas facturadas (C9, filtro invoiced/all) son read-only: no entran
            // al índice de selección ni pueden re-facturarse.
            if (row.invoiced) continue
            const id = rowId(group.client, project, week, row)
            // row ya trae `project` (groupRows lo copia de la entry, y la agrupación
            // por proyecto usa ese mismo valor), así que no se re-asigna.
            map.set(id, { ...row, rowId: id, client: group.client, week: week.week })
          }
        }
      }
    }
    return map
  }, [clientGroups])

  // Siembra el default de colapso. Proyecto: el primero de cada cliente (i===0, el de
  // más horas) arranca abierto; el resto colapsados. Semana: la más reciente (i===0)
  // de CADA proyecto arranca abierta, así al expandir un proyecto se ve su última
  // semana. Cada id se siembra la PRIMERA vez que aparece (refs), así un reload no
  // pisa lo que el usuario abrió/cerró a mano.
  //
  // La lectura/mutación de los refs va en el CUERPO del efecto, no en el updater:
  // bajo StrictMode el updater se invoca dos veces con el mismo `prev`, y si sembrara
  // ahí, la 2da pasada vería el id ya sembrado y no abriría nada.
  useEffect(() => {
    if (!seededWeeksRef.current) seededWeeksRef.current = new Set()
    if (!seededProjectsRef.current) seededProjectsRef.current = new Set()
    const seededWeeks = seededWeeksRef.current
    const seededProjects = seededProjectsRef.current
    const weeksToOpen = []
    const projectsToOpen = []
    for (const group of clientGroups) {
      if (group.isUnassigned) continue
      group.projects.forEach((project, pi) => {
        const pid = projectId(group.client, project)
        if (!seededProjects.has(pid)) {
          seededProjects.add(pid)
          if (pi === 0) projectsToOpen.push(pid)
        }
        project.weeks.forEach((week, wi) => {
          const wid = weekId(group.client, project, week)
          if (seededWeeks.has(wid)) return
          seededWeeks.add(wid)
          if (wi === 0) weeksToOpen.push(wid)
        })
      })
    }
    if (projectsToOpen.length) {
      setOpenProjects((prev) => new Set([...prev, ...projectsToOpen]))
    }
    if (weeksToOpen.length) {
      setOpenWeeks((prev) => new Set([...prev, ...weeksToOpen]))
    }
  }, [clientGroups])

  const selectedRows = [...selectedKeys].map((k) => billableRows.get(k)).filter(Boolean)
  const selectedEntries = selectedRows.flatMap((r) => r.entries)
  const selectedHours = selectedRows.reduce((sum, r) => sum + r.hours, 0)
  const canCreate = can('billing.create')
  // Factura AGRUPADA multi-contractor (slice 03): se emite cuando la selección es de
  // un solo cliente + un solo proyecto (varios contractors permitidos).
  const canBill = canCreate && canBillSelection(selectedRows)
  // Motivo por el que NO se puede emitir (para el aviso). Sólo con algo seleccionado
  // (sin selección no hay nada que avisar). El mensaje se comparte entre el <p> de
  // error y el title del botón para que no se contradigan.
  const blockReason = selectedRows.length ? billBlockReason(selectedRows) : null
  // Sin permiso de facturar, el botón se deshabilita aunque la selección sea válida:
  // el aviso lo explica (si no, quedaría un botón muerto sin motivo). El permiso
  // tiene precedencia sobre el motivo de selección.
  const blockMessage = !selectedRows.length
    ? null
    : !canCreate
      ? 'You do not have permission to issue invoices.'
      : blockReason
        ? billBlockMessage(blockReason, selectedRows)
        : null

  // Contractors incluidos en la factura (para el modal): sólo se computa con el modal
  // abierto (no en cada render de la grilla).
  const selectedContractors = modalOpen ? contractorsFromSelection(selectedRows) : []
  // Cliente único de la selección (canBill lo garantiza): lo usa el modal para
  // scopear los avisos de contrato al proyecto DE ESE cliente (no de un homónimo).
  const selectedClient = modalOpen ? [...selectionScope(selectedRows).clients][0] ?? null : null

  // Horas pendientes POR CONTRACTOR que quedan fuera de esta factura (C11). Sólo con
  // el modal abierto y la selección facturable (un cliente); la lógica pura decide.
  const remainingByContractor =
    modalOpen && canBill ? remainingHoursByContractor(selectedRows, pendingByUnitUser) : []

  function toggleGroup(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Abre el drawer de detalle para una fila. Cada fila es UN log (groupRows emite
  // una fila por hora), así que el detalle es el de esa entry —con su fecha y sus
  // horas propias—; el drawer resuelve la semana desde entry.date.
  function openRowDetail(row) {
    const entry = row?.entries?.[0]
    if (!entry) return
    // billStatus: estado de billing de la fila (bill_to_client). Para las filas de
    // las tabs de lectura (overage/SP/X) no aplica y queda null.
    setDetailRow({ entry, billStatus: row.billStatus ?? null })
  }

  // Colapsa/expande un id en su Set de estado y, al COLAPSAR, poda de la selección
  // las filas colgadas de ese id (prefijo `id||`, que anida projectId ⊂ weekId ⊂
  // rowId): si quedaran seleccionadas pero ocultas, se podrían facturar horas que ya
  // no se ven. Compartido por semana y proyecto — la regla de poda vive en UN solo
  // lugar, así no divergen (justo la divergencia que el comentario de las keys evita).
  function toggleCollapse(setOpen, isOpen, id) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (isOpen) {
      setSelectedKeys((prev) => new Set([...prev].filter((k) => !k.startsWith(`${id}||`))))
    }
  }

  function toggleWeek(id) {
    toggleCollapse(setOpenWeeks, openWeeks.has(id), id)
  }

  function toggleProject(pid) {
    toggleCollapse(setOpenProjects, openProjects.has(pid), pid)
  }

  // Agrega o quita un conjunto de ids de la selección (base de los select-all).
  function applySelection(ids, remove) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (remove) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  // "Select all" acotado a UNA semana (las filas visibles de esa semana): un
  // bulk-select que no toca semanas colapsadas ni oculta lo que se factura.
  function toggleWeekSelection(weekRowIds, allSelected) {
    applySelection(weekRowIds, allSelected)
  }

  // "Select all" de TODO un cliente (todos sus proyectos y semanas). Para no romper
  // el invariante "seleccionado ⊆ visible" (una fila seleccionada pero en un proyecto
  // o semana colapsada se podría facturar sin verse), al seleccionar se ABREN todos
  // los proyectos y semanas del cliente. Al deseleccionar sólo se quitan sus filas
  // (los proyectos/semanas pueden quedar abiertos). Cruzar proveedores no rompe nada:
  // el paso de emisión exige un solo proveedor y guía la selección.
  function toggleClientSelection(clientRowIds, clientProjectIds, clientWeekIds, allSelected) {
    if (!allSelected) {
      setOpenProjects((prev) => new Set([...prev, ...clientProjectIds]))
      setOpenWeeks((prev) => new Set([...prev, ...clientWeekIds]))
    }
    applySelection(clientRowIds, allSelected)
  }

  function handleExport(format) {
    const cols = [
      { header: 'Provider', key: 'provider' },
      { header: 'Client', key: 'client' },
      { header: 'Week', key: 'week' },
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Date', key: 'date' },
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
            projectNumber: project.projectNumber ?? '',
            project: project.project,
            task: '',
            // Bucket "Sin cliente" agrega por proyecto (varios logs) → sin una
            // fecha única que exportar.
            date: '',
            reason: reasonLabel(project.reason),
            hours: project.hours,
            entries: project.entries.length,
            status: 'Pending',
          })
        }
      } else {
        for (const project of group.projects) {
          for (const week of project.weeks) {
            for (const row of week.rows) {
              rows.push({
                provider: row.user,
                client: group.client,
                week: week.week,
                // Por fila (no el número agregado del grupo): en un grupo de nombres
                // homónimos cada fila conserva su número individual, e iguala la
                // granularidad del export read-only (handleExportReadonly).
                projectNumber: row.projectNumber ?? '',
                project: row.project,
                task: row.task,
                date: row.date ? formatDate(row.date) : '',
                reason: '',
                hours: row.hours,
                entries: row.entries.length,
                status: row.billStatus,
              })
            }
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
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Date', key: 'date' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
    ]
    const rows = []
    const push = (group, week, row) =>
      rows.push({
        entity: group.entity || '—',
        ...(showProvider ? { provider: row.user || '' } : {}),
        week: week ? week.week : '—',
        projectNumber: row.projectNumber ?? '',
        project: row.project || '',
        task: row.task || '',
        date: row.date ? formatDate(row.date) : '',
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

  async function handleConfirmBill({ spInvoiceNumber, notes }) {
    // Selección garantizada a un solo cliente + proyecto por canBill; se reusan el
    // scope y los contractors ya derivados (selectionScope / selectedContractors)
    // en vez de recomputarlos por separado.
    const { clients, projects } = selectionScope(selectedRows)
    const [client] = clients
    const [project] = projects
    const contractors = selectedContractors
    const entryCount = selectedEntries.length
    const { invoice } = await api.invoices.createGrouped({
      spInvoiceNumber,
      project,
      client,
      weekStart: weekStartFromSelection(selectedRows),
      notes,
      contractors,
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
        spInvoiceNumber,
        project,
        client,
        contractors: contractors.map((c) => c.contractor),
        contractorCount: contractors.length,
        entryCount,
        source: 'billing',
      },
    })
    setModalOpen(false)
    setNotice(
      `Invoice ${spInvoiceNumber} issued — ${contractors.length} contractor${contractors.length === 1 ? '' : 's'}, ${formatHours(selectedHours)} h.`,
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
                  <Link className="btn btn--ghost btn--sm" to={entriesLinkTo('bill_to_client')}>
                    View in Entries <ArrowRight size={14} aria-hidden="true" />
                  </Link>
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
              {canCreate && selectedKeys.size > 0 && (
                <div className="selbar-wrap">
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
                        title={blockMessage ?? undefined}
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
                </div>
              )}

              {blockMessage && <p className="field__error">{blockMessage}</p>}

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
                              <th scope="col" className="col-projnum">Project #</th>
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
                                <td className="cell-mono col-projnum">{project.projectNumber || '—'}</td>
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
                        <div className="bill-client__id">
                        {canCreate &&
                          (() => {
                            // Todas las filas seleccionables del cliente (todos sus
                            // proyectos y semanas) + los ids de esos proyectos y
                            // semanas, para el select-all por cliente que los abre y
                            // selecciona de una.
                            const clientProjectIds = group.projects.map((p) =>
                              projectId(group.client, p),
                            )
                            const clientWeekIds = group.projects.flatMap((p) =>
                              p.weeks.map((w) => weekId(group.client, p, w)),
                            )
                            const clientRowIds = group.projects.flatMap((p) =>
                              p.weeks.flatMap((w) =>
                                w.rows
                                  .filter((r) => !r.invoiced)
                                  .map((r) => rowId(group.client, p, w, r)),
                              ),
                            )
                            if (clientRowIds.length === 0) return null
                            const allSel = clientRowIds.every((k) => selectedKeys.has(k))
                            return (
                              <Checkbox
                                checked={allSel}
                                indeterminate={
                                  !allSel && clientRowIds.some((k) => selectedKeys.has(k))
                                }
                                onChange={() =>
                                  toggleClientSelection(
                                    clientRowIds,
                                    clientProjectIds,
                                    clientWeekIds,
                                    allSel,
                                  )
                                }
                                ariaLabel={`Select all billable rows for ${group.client}`}
                              />
                            )
                          })()}
                        <h3 className="bill-client__name">{group.client}</h3>
                        </div>
                        <span className="bill-client__hours">{formatHours(group.hours)} h</span>
                      </header>
                      {group.projects.map((project) => {
                        const pid = projectId(group.client, project)
                        // El proyecto es la unidad facturable: nivel colapsable entre
                        // cliente y semana. Estado absoluto (openProjects), igual que
                        // las semanas; el seed abre el primero de cada cliente.
                        const projectOpen = openProjects.has(pid)
                        return (
                          <div className="bill-project" key={pid}>
                            <button
                              type="button"
                              className="bill-project__toggle"
                              onClick={() => toggleProject(pid)}
                              aria-expanded={projectOpen}
                            >
                              <span className="bill-project__chev" aria-hidden="true">
                                {projectOpen ? '▾' : '▸'}
                              </span>
                              <span className="bill-project__label">
                                {project.projectNumber && (
                                  <span className="bill-project__num cell-mono">
                                    {project.projectNumber}
                                  </span>
                                )}
                                {project.project || '—'}
                              </span>
                              <span className="bill-project__hours">
                                {formatHours(project.hours)} h
                              </span>
                            </button>
                            {projectOpen &&
                              project.weeks.map((week) => {
                                const wid = weekId(group.client, project, week)
                                // Estado absoluto: abierta sólo si está en openWeeks (el
                                // seed abrió la más reciente de cada proyecto).
                                const open = openWeeks.has(wid)
                                // Sólo las filas pendientes son seleccionables (las
                                // facturadas van read-only con el filtro invoiced/all).
                                const weekRowIds = week.rows
                                  .filter((row) => !row.invoiced)
                                  .map((row) => rowId(group.client, project, week, row))
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
                                                  <Checkbox
                                                    checked={allWeekSelected}
                                                    indeterminate={
                                                      !allWeekSelected &&
                                                      weekRowIds.some((k) => selectedKeys.has(k))
                                                    }
                                                    onChange={() =>
                                                      toggleWeekSelection(weekRowIds, allWeekSelected)
                                                    }
                                                    ariaLabel={`Select all rows in ${week.week}`}
                                                  />
                                                </th>
                                              )}
                                              <th scope="col">Provider</th>
                                              <th scope="col">Project · task</th>
                                              <th scope="col">Date</th>
                                              <th scope="col" className="col-num">Hours</th>
                                              <th scope="col">Status</th>
                                              <th scope="col" style={{ width: 40 }}>
                                                <span className="sr-only">Detail</span>
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {week.rows.map((row) => {
                                              const id = rowId(group.client, project, week, row)
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
                                                        <Checkbox
                                                          checked={selectedKeys.has(id)}
                                                          onChange={() => toggleGroup(id)}
                                                          ariaLabel={`Select ${row.user} · ${row.project}`}
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
                                                  <td className="cell-mono">
                                                    {row.date ? formatDate(row.date) : '—'}
                                                  </td>
                                                  <td className="col-num cell-mono">
                                                    {formatHours(row.hours)}
                                                  </td>
                                                  <td>
                                                    {row.invoiced ? (
                                                      <BillingBadge status={row.billStatus} />
                                                    ) : (
                                                      <span className="badge badge--tobill">to bill</span>
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
                          </div>
                        )
                      })}
                    </section>
                  ),
                )}
              </div>
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
        <GroupedBillModal
          contractors={selectedContractors}
          client={selectedClient}
          entries={selectedEntries}
          hours={selectedHours}
          projects={projects}
          resolveClient={resolveClient}
          remainingByContractor={remainingByContractor}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirmBill}
        />
      )}

      {detailRow && (() => {
        // Cada fila de la grilla es un log individual, así que el drawer muestra esa
        // entry tal cual (sus horas ya son las de la fila).
        const entry = detailRow.entry
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
            onClose={() => setDetailRow(null)}
          />
        )
      })()}
    </>
  )
}
