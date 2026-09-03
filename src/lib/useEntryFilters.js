import { useCallback, useMemo, useState } from 'react'
import { sundayWeek, weekStartISO } from './format.js'

/**
 * Estado y lógica de filtrado de la grilla (FR-03), centralizado en un solo
 * lugar. Maneja multi-selects (Contractor, Client, Project, Payment Status),
 * rango de fechas y dos filtros de semana (domingo–sábado, ver sundayWeek: 1..54):
 *   - `week`: número de semana year-blind (input "W35" de Payments) — compara sólo
 *     el número, no el año (limitación conocida: la semana N matchea en todos los
 *     años del dataset).
 *   - `weekStart`: semana física exacta, year-aware (navegador de Entries) — matchea
 *     el domingo que la inicia, así distingue W35/2025 de W35/2026.
 * Ver el término "Week" en CONTEXT.md.
 *
 * El filtro se aplica ENCIMA de los datos crudos; la tab (FR-04) y la regla de
 * "un proveedor por pago" se resuelven aparte en App.
 */
const EMPTY_FILTERS = {
  contractors: [],
  clients: [],
  projects: [],
  tasks: [],
  billingStatuses: [], // 'Pending' | 'Invoiced' | 'Collected' | 'Paid'
  // Estado de aprobación de la entry (viene de Zoho approval_status y se guarda
  // tal cual). Opciones fijas 'Approved' | 'Rejected' | 'Pending' — no se derivan
  // de las entries, igual que billingStatuses.
  statuses: [],
  // allocation de la entry. El valor null (sin clasificar) se representa con el
  // centinela 'unallocated' para poder tildarlo en el filtro — es justamente el
  // caso más buscado ("ver sólo lo que falta triagear").
  allocations: [], // 'unallocated' | 'bill_to_client' | 'overage' | 'sp_internal' | 'unknown'
  dateFrom: '',
  dateTo: '',
  // Número de semana (year-blind): lo usa el filtro numérico "W35" de Payments.
  // Matchea sólo el número de sundayWeek, ignorando el año (limitación conocida).
  week: '',
  // Semana física exacta (year-aware): domingo (YYYY-MM-DD) que la inicia. Lo usa
  // el navegador de semana de Entries. A diferencia de `week`, distingue W35/2025
  // de W35/2026. Ver el término "Week" en CONTEXT.md.
  weekStart: '',
}

// Centinela del filtro para las horas sin clasificar (allocation === null).
export const UNALLOCATED = 'unallocated'
// Centinela del filtro para las horas YA APLICADAS (cualquier allocation != null),
// sin tener que tildar las 4 categorías una por una.
export const ALLOCATED = 'allocated'

// Centinela del filtro de Cliente: agrupa bajo una sola opción a todo lo que NO
// está en el maestro de clientes (nombre legacy o cliente sin resolver), para que
// el desplegable liste exactamente los clientes de la página Clients + esta. Lo
// comparten Entries, Billing y Projects.
export const OTHER_CLIENT = 'Others (not in Clients)'

/**
 * Clave con la que un cliente resuelto entra al filtro de Cliente: el nombre del
 * maestro tal cual si está en él, o el centinela Others si no (legacy o vacío).
 * La usan por igual el matcheo (applyEntryFilters) y las opciones
 * (buildFilterOptions) para que el dropdown y el filtro hablen del mismo valor.
 * @param {string} client
 * @param {Set<string>} masterClients
 * @returns {string}
 */
export const clientFilterKey = (client, masterClients) =>
  masterClients.has(client) ? client : OTHER_CLIENT

/**
 * @param {Partial<typeof EMPTY_FILTERS>} [initial] filtros de arranque — los usa
 *   Client Summary al mandar a Entries ya filtrado por cliente/proyecto. Sólo
 *   se lee en el primer render: después manda el estado del usuario.
 */
export function useEntryFilters(initial) {
  const [filters, setFilters] = useState(() =>
    initial ? { ...EMPTY_FILTERS, ...initial } : EMPTY_FILTERS,
  )

  // Toggle de un valor dentro de un filtro de tipo array (multi-select).
  const toggleValue = useCallback((key, value) => {
    setFilters((prev) => {
      const arr = prev[key]
      return {
        ...prev,
        [key]: arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value],
      }
    })
  }, [])

  // Set de un campo escalar (fechas, semana).
  const setField = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clear = useCallback(() => setFilters(EMPTY_FILTERS), [])

  const isActive = useMemo(
    () =>
      filters.contractors.length > 0 ||
      filters.clients.length > 0 ||
      filters.projects.length > 0 ||
      filters.tasks.length > 0 ||
      filters.billingStatuses.length > 0 ||
      filters.statuses.length > 0 ||
      filters.allocations.length > 0 ||
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      Boolean(filters.week) ||
      Boolean(filters.weekStart),
    [filters],
  )

  return { filters, toggleValue, setField, clear, isActive }
}

// Dimensiones que se muestran como multi-select: clave del filtro → campo de la
// entry del que salen sus opciones. Billing Status queda afuera a propósito: sus
// cuatro estados son fijos y no se derivan de las entries.
const OPTION_DIMENSIONS = {
  contractors: (entry) => entry.user,
  clients: (entry) => entry.client,
  projects: (entry) => entry.project,
  tasks: (entry) => entry.task,
}

// localeCompare 'es': un .sort() plano manda los acentuados (Álvaro, Ñandú) al
// final del dropdown, donde nadie los busca. Exportada porque las páginas con
// filtro de Cliente (Entries, Billing) arman su lista de opciones uniendo los
// clientes derivados de las filas con el maestro, y necesitan el mismo criterio
// de orden/deduplicación.
export const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

/**
 * Opciones del desplegable de Cliente: los nombres del maestro (los mismos que la
 * página Clients), ordenados, más el centinela Others al final SÓLO si `hasOther`.
 * Lo comparten Entries, Billing y Projects para que la lista se arme igual en las
 * tres (cada una calcula `hasOther` a su manera: scoped por buildFilterOptions en
 * Entries/Billing, sobre los proyectos resueltos en Projects).
 * @param {Array<{clientName?: string}>} clients  maestro de clientes
 * @param {boolean} hasOther  hay al menos una fila cuyo cliente cae fuera del maestro
 * @returns {string[]}
 */
export const clientFilterOptions = (clients, hasOther) => {
  const names = sortedUnique(clients.map((c) => c.clientName))
  return hasOther ? [...names, OTHER_CLIENT] : names
}

/**
 * Opciones entrelazadas de los multi-selects: cada lista se arma sobre las
 * entries que pasan TODOS los demás filtros (incluidos semana y rango de
 * fechas), no sobre el total.
 *
 * Sin esto las tres listas son independientes y habilitan combinaciones que no
 * existen — tildar Project "Call Center - Stage 2" y Contractor "Claudio Riva"
 * daba "0 entries" sin ninguna pista de cuál de los dos sobraba. Cruzándolas, el
 * dropdown de Contractor sólo ofrece a quienes cargaron horas en ese proyecto.
 *
 * El propio filtro de la dimensión se excluye del cruce (si no, tildar un
 * cliente dejaría su lista con un solo elemento), y los valores ya tildados se
 * agregan siempre: si el cruce con las otras dimensiones los excluye, el usuario
 * no tendría cómo destildarlos y quedaría trabado en cero.
 *
 * ALCANCE de la garantía: lo que no puede dar cero es la combinación de dos
 * dimensiones de lista entre sí. Los filtros de semana (`week` numérico y
 * `weekStart` year-aware) y el rango de fechas no son listas, así que sí pueden
 * vaciarlas todas — con una semana sin horas cargadas los tres dropdowns quedan en
 * "No options" y la grilla en cero. Es información honesta ("no hay nada esa
 * semana") y se sale cambiando la semana o con Clear, pero no es un caso que el
 * cruce prevenga.
 *
 * @param {import('./data').TimeEntry[]} entries
 * @param {typeof EMPTY_FILTERS} filters
 * @param {Map<string, {status: string}>} invoiceByEntryId
 * @param {Set<string>} [masterClients] si viene, la dimensión Cliente ofrece las
 *   mismas claves que matchea el filtro (nombre del maestro o centinela Others).
 * @returns {{contractors: string[], clients: string[], projects: string[], tasks: string[]}}
 */
export function buildFilterOptions(entries, filters, invoiceByEntryId, masterClients) {
  const options = {}
  for (const [key, pick] of Object.entries(OPTION_DIMENSIONS)) {
    const scoped = applyEntryFilters(entries, { ...filters, [key]: [] }, invoiceByEntryId, masterClients)
    // El dropdown de Cliente ofrece las claves del filtro (nombre del maestro o
    // Others); el resto de dimensiones, su valor crudo.
    const pickValue =
      key === 'clients' && masterClients
        ? (entry) => clientFilterKey(entry.client, masterClients)
        : pick
    options[key] = sortedUnique([...scoped.map(pickValue), ...(filters[key] ?? [])])
  }
  return options
}

/**
 * Aplica los filtros a una lista de entradas.
 *
 * @param {import('./data').TimeEntry[]} entries
 * @param {typeof EMPTY_FILTERS} filters
 * @param {Map<string, {status: string}>} invoiceByEntryId  mapa id→factura para resolver Billing Status
 * @param {Set<string>} [masterClients] si viene, el filtro de Cliente matchea por
 *   clave (nombre del maestro o centinela Others); si no, por el valor crudo de
 *   entry.client (comportamiento previo, para los llamadores que no derivan cliente).
 * @returns {import('./data').TimeEntry[]}
 */
export function applyEntryFilters(entries, filters, invoiceByEntryId, masterClients) {
  const week = filters.week ? Number(filters.week) : null

  return entries.filter((entry) => {
    if (filters.contractors.length && !filters.contractors.includes(entry.user)) {
      return false
    }
    if (filters.clients.length) {
      const clientValue = masterClients ? clientFilterKey(entry.client, masterClients) : entry.client
      if (!filters.clients.includes(clientValue)) return false
    }
    if (filters.projects.length && !filters.projects.includes(entry.project)) {
      return false
    }
    if (filters.tasks.length && !filters.tasks.includes(entry.task)) {
      return false
    }
    // Estado de aprobación (Approved/Rejected/Pending): match exacto contra el
    // valor guardado. Una entry con un status inesperado (fuera de los tres) no
    // matchea ninguna opción, así que un filtro activo la oculta — coherente con
    // el resto de los multi-selects.
    if (filters.statuses.length && !filters.statuses.includes(entry.status)) {
      return false
    }
    if (filters.billingStatuses.length) {
      const billingStatus = invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending'
      if (!filters.billingStatuses.includes(billingStatus)) return false
    }
    if (filters.allocations?.length) {
      // Match por OR: la allocation puntual seleccionada, el centinela UNALLOCATED
      // (sin clasificar) o el centinela ALLOCATED (cualquiera aplicada → "ya
      // aplicadas"). `|| null` (no `??`) para que un '' —además de null— cuente como
      // sin clasificar y no como aplicada. Así ALLOCATED convive con selecciones
      // puntuales.
      const alloc = entry.allocation || null
      const key = alloc ?? UNALLOCATED
      const matches =
        filters.allocations.includes(key) ||
        (alloc !== null && filters.allocations.includes(ALLOCATED))
      if (!matches) return false
    }
    // log_date es ISO YYYY-MM-DD → la comparación de strings respeta el orden.
    if (filters.dateFrom && (!entry.date || entry.date < filters.dateFrom)) {
      return false
    }
    if (filters.dateTo && (!entry.date || entry.date > filters.dateTo)) {
      return false
    }
    if (week !== null && !Number.isNaN(week)) {
      if (sundayWeek(entry.date) !== week) return false
    }
    // Semana física exacta (navegador de Entries): matchea por el domingo que
    // inicia la semana de la entry, así distingue la misma semana de años
    // distintos — a diferencia del filtro `week` de arriba, year-blind. Una entry
    // sin fecha válida tiene weekStartISO null, que nunca iguala un domingo, así
    // que un filtro activo la oculta (coherente con el resto de los filtros).
    if (filters.weekStart) {
      if (weekStartISO(entry.date) !== filters.weekStart) return false
    }
    return true
  })
}
