/**
 * Capa de datos del módulo Collections (FR-09).
 *
 * @typedef {Object} Collection
 * @property {string|number} id
 * @property {string|number} invoiceId
 * @property {number} amountReceived
 * @property {string} collectionDate     ISO YYYY-MM-DD
 * @property {?string} bankReference
 * @property {?string} notes
 * @property {string} createdAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { updateInvoiceStatus } from './data'

const EPSILON = 0.005

/**
 * Estado de cobro de una factura según lo cobrado vs el total.
 * @param {number} total
 * @param {number} collected
 * @returns {'Pending Collection'|'Partial Collection'|'Collected'}
 */
export function collectionStatus(total, collected) {
  if (collected <= EPSILON) return 'Pending Collection'
  if (collected >= total - EPSILON) return 'Collected'
  return 'Partial Collection'
}

export const COLLECTION_STATUSES = [
  'Pending Collection',
  'Partial Collection',
  'Collected',
]

/**
 * Nivel de alerta de cobro de una factura (FR-12).
 *   overdue : days_pending > payment_terms_days
 *   warning : days_pending >= payment_terms_days - warning_days_before_due
 *   on_time : el resto
 * @returns {'overdue'|'warning'|'on_time'}
 */
export function collectionAlertLevel(daysPending, paymentTermsDays, warningDaysBeforeDue) {
  const terms = paymentTermsDays ?? 30
  if (daysPending > terms) return 'overdue'
  if (daysPending >= terms - (warningDaysBeforeDue ?? 7)) return 'warning'
  return 'on_time'
}

// ---------- Configuración de alertas de cobro (FR-12) ----------

let demoCollectionAlertSettings = {
  warningDaysBeforeDue: 7,
  overdueImmediately: true,
  emailRecipients: ['finanzas@southpoint.local'],
  emailFrequency: 'daily',
  updatedAt: null,
  updatedBy: null,
}

function rowToCollectionAlertSettings(row) {
  return {
    warningDaysBeforeDue: row.warning_days_before_due,
    overdueImmediately: row.overdue_immediately,
    emailRecipients: row.email_recipients ?? [],
    emailFrequency: row.email_frequency,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function getCollectionAlertSettings() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return { ...demoCollectionAlertSettings }
  }
  const { data, error } = await supabase
    .from('collection_alert_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return { ...demoCollectionAlertSettings }
  return rowToCollectionAlertSettings(data)
}

export async function updateCollectionAlertSettings(settings, updatedBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    demoCollectionAlertSettings = {
      ...demoCollectionAlertSettings,
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    }
    return { ...demoCollectionAlertSettings }
  }
  const { data, error } = await supabase
    .from('collection_alert_settings')
    .update({
      warning_days_before_due: settings.warningDaysBeforeDue,
      overdue_immediately: settings.overdueImmediately,
      email_recipients: settings.emailRecipients,
      email_frequency: settings.emailFrequency,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToCollectionAlertSettings(data)
}

/** @type {Collection[]} — cobros demo coherentes con las facturas mock. */
const MOCK_COLLECTIONS = [
  // inv-mock-1 (Collected, $1150) → cobro completo
  {
    id: 'col-1',
    invoiceId: 'inv-mock-1',
    amountReceived: 1150,
    collectionDate: '2026-04-15',
    bankReference: 'BBVA-558210',
    notes: null,
    createdAt: '2026-05-20T11:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  // inv-mock-2 (Paid, $800) → cobro completo
  {
    id: 'col-2',
    invoiceId: 'inv-mock-2',
    amountReceived: 800,
    collectionDate: '2026-05-18',
    bankReference: 'ITAU-99120',
    notes: null,
    createdAt: '2026-05-18T09:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  // inv-mock-3 (Invoiced, $650) → cobro PARCIAL de $300 (saldo $350)
  {
    id: 'col-3',
    invoiceId: 'inv-mock-3',
    amountReceived: 300,
    collectionDate: '2026-05-02',
    bankReference: 'BBVA-560044',
    notes: 'Anticipo',
    createdAt: '2026-05-02T15:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

let demoCollections = MOCK_COLLECTIONS.map((c) => ({ ...c }))

function rowToCollection(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amountReceived: Number(row.amount_received),
    collectionDate: row.collection_date,
    bankReference: row.bank_reference ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

/** @returns {Promise<Collection[]>} todos los cobros registrados. */
export async function getCollections() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    return demoCollections.map((c) => ({ ...c }))
  }
  const { data, error } = await supabase
    .from('collections')
    .select('id, invoice_id, amount_received, collection_date, bank_reference, notes, created_at, created_by')
    .order('collection_date', { ascending: false })
  if (error) {
    console.warn('[collections] getCollections falló —', error.message)
    return demoCollections.map((c) => ({ ...c }))
  }
  return data.map(rowToCollection)
}

/**
 * Registra un cobro. Si con este cobro la factura queda full (>= total) y está
 * en 'Invoiced', avanza la factura a 'Collected' (con su transición en
 * invoice_status_history).
 *
 * @param {{ id, status, totalAmount }} invoice
 * @param {{ amountReceived:number, collectionDate:string, bankReference?:string, notes?:string }} payload
 * @param {number} alreadyCollected   suma cobrada previa
 * @param {?string} createdBy
 * @returns {Promise<{ collection: Collection, becameCollected: boolean }>}
 */
export async function createCollection(invoice, payload, alreadyCollected, createdBy) {
  const newSum = alreadyCollected + Number(payload.amountReceived)
  const becameCollected =
    newSum >= invoice.totalAmount - EPSILON && invoice.status === 'Invoiced'

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    const collection = {
      id: `col-demo-${Date.now()}`,
      invoiceId: invoice.id,
      amountReceived: Number(payload.amountReceived),
      collectionDate: payload.collectionDate,
      bankReference: payload.bankReference || null,
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoCollections = [collection, ...demoCollections]
    if (becameCollected) {
      await updateInvoiceStatus({
        invoiceId: invoice.id,
        fromStatus: 'Invoiced',
        toStatus: 'Collected',
        changedBy: createdBy ?? null,
        note: 'Full collection registered',
      })
    }
    return { collection, becameCollected }
  }

  const { data, error } = await supabase
    .from('collections')
    .insert({
      invoice_id: invoice.id,
      amount_received: Number(payload.amountReceived),
      collection_date: payload.collectionDate,
      bank_reference: payload.bankReference || null,
      notes: payload.notes || null,
      created_by: createdBy || null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  if (becameCollected) {
    await updateInvoiceStatus({
      invoiceId: invoice.id,
      fromStatus: 'Invoiced',
      toStatus: 'Collected',
      changedBy: createdBy ?? null,
      note: 'Full collection registered',
    })
  }

  return { collection: rowToCollection(data), becameCollected }
}
