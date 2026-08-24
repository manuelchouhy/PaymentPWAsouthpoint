import { useCallback, useMemo, useState } from 'react'
import { sundayWeek } from './format.js'

/**
 * Estado y lógica de filtrado de la grilla (FR-03), centralizado en un solo
 * lugar. Maneja multi-selects (Contractor, Client, Project, Payment Status),
 * rango de fechas y número de semana (domingo–sábado, ver sundayWeek: 1..54).
 * El filtro de semana compara sólo el número, no el año (limitación conocida:
 * si el dataset abarca varios años, la semana N matchea en todos).
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
  // allocation de la entry. El valor null (sin clasificar) se representa con el
  // centinela 'unallocated' para poder tildarlo en el filtro — es justamente el
  // caso más buscado ("ver sólo lo que falta triagear").
  allocations: [], // 'unallocated' | 'bill_to_client' | 'overage' | 'sp_internal' | 'unknown'
  dateFrom: '',
  dateTo: '',
  week: '',
}

// Centinela del filtro para las horas sin clasificar (allocation === null).
export const UNALLOCATED = 'unallocated'
// Centinela del filtro para las horas YA APLICADAS (cualquier allocation != null),
// sin tener que tildar las 4 categorías una por una.
export const ALLOCATED = 'allocated'

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
      filters.allocations.length > 0 ||
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      Boolean(filters.week),
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
// final del dropdown, donde nadie los busca.
const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

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
 * dimensiones de lista entre sí. Semana y rango de fechas no son listas, así
 * que sí pueden vaciarlas todas — con week = 53 sin horas cargadas, los tres
 * dropdowns quedan en "No options" y la grilla en cero. Es información honesta
 * ("no hay nada esa semana") y se sale cambiando la semana o con Clear, pero no
 * es un caso que el cruce prevenga.
 *
 * @param {import('./data').TimeEntry[]} entries
 * @param {typeof EMPTY_FILTERS} filters
 * @param {Map<string, {status: string}>} invoiceByEntryId
 * @returns {{contractors: string[], clients: string[], projects: string[], tasks: string[]}}
 */
export function buildFilterOptions(entries, filters, invoiceByEntryId) {
  const options = {}
  for (const [key, pick] of Object.entries(OPTION_DIMENSIONS)) {
    const scoped = applyEntryFilters(entries, { ...filters, [key]: [] }, invoiceByEntryId)
    options[key] = sortedUnique([...scoped.map(pick), ...(filters[key] ?? [])])
  }
  return options
}

/**
 * Aplica los filtros a una lista de entradas.
 *
 * @param {import('./data').TimeEntry[]} entries
 * @param {typeof EMPTY_FILTERS} filters
 * @param {Map<string, {status: string}>} invoiceByEntryId  mapa id→factura para resolver Billing Status
 * @returns {import('./data').TimeEntry[]}
 */
export function applyEntryFilters(entries, filters, invoiceByEntryId) {
  const week = filters.week ? Number(filters.week) : null

  return entries.filter((entry) => {
    if (filters.contractors.length && !filters.contractors.includes(entry.user)) {
      return false
    }
    if (filters.clients.length && !filters.clients.includes(entry.client)) {
      return false
    }
    if (filters.projects.length && !filters.projects.includes(entry.project)) {
      return false
    }
    if (filters.tasks.length && !filters.tasks.includes(entry.task)) {
      return false
    }
    if (filters.billingStatuses.length) {
      const billingStatus = invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending'
      if (!filters.billingStatuses.includes(billingStatus)) return false
    }
    if (filters.allocations?.length) {
      // Match por OR: la allocation puntual seleccionada, el centinela UNALLOCATED
      // (sin clasificar, null) o el centinela ALLOCATED (cualquiera != null → "ya
      // aplicadas"). Así ALLOCATED convive con selecciones puntuales.
      const alloc = entry.allocation ?? null
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
    return true
  })
}
