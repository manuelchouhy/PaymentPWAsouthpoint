import { useCallback, useMemo, useState } from 'react'
import { isoWeek } from './format'

/**
 * Estado y lógica de filtrado de la grilla (FR-03), centralizado en un solo
 * lugar. Maneja multi-selects (Contractor, Client, Project, Payment Status),
 * rango de fechas y número de semana ISO.
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
  dateFrom: '',
  dateTo: '',
  week: '',
}

export function useEntryFilters() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)

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
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      Boolean(filters.week),
    [filters],
  )

  return { filters, toggleValue, setField, clear, isActive }
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
    // log_date es ISO YYYY-MM-DD → la comparación de strings respeta el orden.
    if (filters.dateFrom && (!entry.date || entry.date < filters.dateFrom)) {
      return false
    }
    if (filters.dateTo && (!entry.date || entry.date > filters.dateTo)) {
      return false
    }
    if (week !== null && !Number.isNaN(week)) {
      if (isoWeek(entry.date) !== week) return false
    }
    return true
  })
}
