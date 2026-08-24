/**
 * Capa de datos del módulo Payments al contractor (FR-10).
 * Un payment se vincula a una invoice pagable: 'Invoiced' o 'Collected' (flujo
 * Billing → Payments; Collections no es parte del flujo por ahora).
 *
 * @typedef {Object} ContractorPayment
 * @property {string|number} id
 * @property {string|number} invoiceId
 * @property {number} amountPaid
 * @property {string} paymentDate          ISO YYYY-MM-DD
 * @property {?string} transferReference
 * @property {?string} bankMethod
 * @property {?string} notes
 * @property {boolean} backDated
 * @property {string} createdAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { updateInvoiceStatus } from './data'

export const BANK_METHODS = ['BBVA', 'Itaú', 'Santander', 'Other']

/**
 * Nivel de alerta de pago al contractor (FR-13).
 *   overdue : days_until_due < 0
 *   warning : days_until_due <= warning_days_before_due
 *   on_time : el resto
 * @returns {'overdue'|'warning'|'on_time'}
 */
export function paymentAlertLevel(daysUntilDue, warningDaysBeforeDue) {
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue <= (warningDaysBeforeDue ?? 3)) return 'warning'
  return 'on_time'
}

let demoPaymentAlertSettings = {
  warningDaysBeforeDue: 3,
  emailRecipients: ['pagos@southpoint.local'],
  emailFrequency: 'daily',
  updatedAt: null,
  updatedBy: null,
}

function rowToPaymentAlertSettings(row) {
  return {
    warningDaysBeforeDue: row.warning_days_before_due,
    emailRecipients: row.email_recipients ?? [],
    emailFrequency: row.email_frequency,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function getPaymentAlertSettings() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return { ...demoPaymentAlertSettings }
  }
  const { data, error } = await supabase
    .from('payment_alert_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ...demoPaymentAlertSettings }
  return rowToPaymentAlertSettings(data)
}

export async function updatePaymentAlertSettings(settings, updatedBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    demoPaymentAlertSettings = {
      ...demoPaymentAlertSettings,
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    }
    return { ...demoPaymentAlertSettings }
  }
  const { data, error } = await supabase
    .from('payment_alert_settings')
    .update({
      warning_days_before_due: settings.warningDaysBeforeDue,
      email_recipients: settings.emailRecipients,
      email_frequency: settings.emailFrequency,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToPaymentAlertSettings(data)
}

function todayISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/** @type {ContractorPayment[]} — pago demo de la factura inv-mock-2 (Paid). */
const MOCK_PAYMENTS = [
  {
    id: 'pay-1',
    invoiceId: 'inv-mock-2',
    amountPaid: 800,
    paymentDate: '2026-05-25',
    transferReference: 'TRX-77120',
    bankMethod: 'Itaú',
    notes: null,
    backDated: false,
    createdAt: '2026-05-25T16:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

let demoPayments = MOCK_PAYMENTS.map((p) => ({ ...p }))

function rowToPayment(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    // Pago de overage: horas que cubre (entry_ids) y a quién se le pagó (user_name).
    // Para pagos por factura quedan vacíos (el contractor sale de la factura).
    entryIds: (row.entry_ids ?? []).map(String),
    userName: row.user_name ?? null,
    amountPaid: Number(row.amount_paid),
    currency: row.currency ?? 'USD',
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    paymentDate: row.payment_date,
    transferReference: row.transfer_reference ?? null,
    bankMethod: row.bank_method ?? null,
    notes: row.notes ?? null,
    backDated: Boolean(row.back_dated),
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

// Columnas de un pago (se agregan entry_ids/user_name de los pagos de overage).
const PAYMENT_COLUMNS =
  'id, invoice_id, entry_ids, user_name, amount_paid, currency, exchange_rate, payment_date, transfer_reference, bank_method, notes, back_dated, created_at, created_by'

/** @returns {Promise<ContractorPayment[]>} */
export async function getPayments() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    return demoPayments.map((p) => ({ ...p }))
  }
  const { data, error } = await supabase
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .order('payment_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data.map(rowToPayment)
}

/** El pago asociado a una factura (o null). */
export async function getPaymentByInvoice(invoiceId) {
  if (!isSupabaseConfigured) {
    return demoPayments.find((p) => p.invoiceId === invoiceId) ?? null
  }
  const { data, error } = await supabase
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || !data.length) return null
  return rowToPayment(data[0])
}

/**
 * Registra un pago al contractor. VALIDACIÓN DURA: la invoice debe estar en
 * 'Invoiced' o 'Collected' (flujo Billing → Payments: una factura emitida en
 * Billing se paga directo, Collections no es parte del flujo por ahora). Al
 * confirmar, avanza la invoice a 'Paid' (+ historial) desde su estado actual.
 *
 * @param {{ id, status, totalAmount }} invoice
 * @param {{ amountPaid:number, paymentDate:string, transferReference?:string, bankMethod?:string, notes?:string }} payload
 * @param {?string} createdBy
 * @returns {Promise<{ payment: ContractorPayment }>}
 */
export async function createPayment(invoice, payload, createdBy) {
  if (invoice.status !== 'Invoiced' && invoice.status !== 'Collected') {
    const err = new Error('Invoice must be Invoiced or Collected before payment')
    err.code = 'not_collected'
    throw err
  }

  const backDated = payload.paymentDate < todayISO()

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    const payment = {
      id: `pay-demo-${Date.now()}`,
      invoiceId: invoice.id,
      amountPaid: Number(payload.amountPaid),
      currency: invoice.currency ?? 'USD',
      exchangeRate: payload.exchangeRate ?? null,
      paymentDate: payload.paymentDate,
      transferReference: payload.transferReference || null,
      bankMethod: payload.bankMethod || null,
      notes: payload.notes || null,
      backDated,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoPayments = [payment, ...demoPayments]
    await updateInvoiceStatus({
      invoiceId: invoice.id,
      fromStatus: invoice.status,
      toStatus: 'Paid',
      changedBy: createdBy ?? null,
      note: 'Contractor payment registered',
    })
    return { payment }
  }

  // Registro ATÓMICO en el servidor (función register_contractor_payment):
  // valida que la factura esté en 'Invoiced' o 'Collected' (migración 0036),
  // inserta el pago, avanza la factura a 'Paid' y registra el historial, todo en
  // una sola transacción. El índice único payments_invoice_id_unique impide un
  // segundo pago para la misma factura.
  const { data, error } = await supabase.rpc('register_contractor_payment', {
    p_invoice_id: invoice.id,
    p_amount_paid: Number(payload.amountPaid),
    p_payment_date: payload.paymentDate,
    p_transfer_reference: payload.transferReference || null,
    p_bank_method: payload.bankMethod || null,
    p_notes: payload.notes || null,
    p_back_dated: backDated,
    p_created_by: createdBy || null,
    p_exchange_rate: payload.exchangeRate ?? null,
  })
  if (error) {
    if (error.code === '23505') {
      const err = new Error('A payment is already registered for this invoice.')
      err.code = 'duplicate'
      throw err
    }
    if (error.message?.includes('not_collected')) {
      const err = new Error('Invoice must be Invoiced or Collected before payment')
      err.code = 'not_collected'
      throw err
    }
    throw new Error(error.message)
  }

  const row = Array.isArray(data) ? data[0] : data
  return { payment: rowToPayment(row) }
}

/**
 * Registra un pago de OVERAGE (sin factura): cubre las horas `entryIds` de un
 * contractor. invoice_id queda NULL y no avanza ninguna factura. Insert directo
 * (hay policy de insert para authenticated). Las horas quedan congeladas
 * (entryFreeze) por estar en entry_ids de un pago, y salen de la tab Overage.
 *
 * Anti doble-pago: ninguna hora puede quedar cubierta por dos pagos (ni por un
 * pago y una factura). En Supabase lo garantiza el trigger
 * payments_entry_ids_no_overlap (migración 0037), que rechaza el insert con el
 * SQLSTATE propio 'OV001' si algún entry_id ya está cubierto; acá se traduce a un
 * error 'overlap' legible. En demo se replica el chequeo (best-effort, sólo pagos).
 *
 * @param {{ userName:string, entryIds:Array<string|number>, amountPaid:number, paymentDate:string, transferReference?:string, bankMethod?:string, notes?:string, exchangeRate?:?number, currency?:string }} payload
 * @param {?string} createdBy
 * @returns {Promise<{ payment: ContractorPayment }>}
 */
export async function createOveragePayment(payload, createdBy) {
  // entry_ids es bigint[]: se descartan ids no numéricos (igual que createInvoice)
  // para no meter NaN en el array y romper el insert.
  const entryIds = (payload.entryIds ?? []).map(Number).filter(Number.isFinite)
  if (!payload.userName || entryIds.length === 0) {
    throw new Error('An overage payment needs a contractor and at least one hour.')
  }
  const backDated = payload.paymentDate < todayISO()

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    // Anti doble-pago best-effort en demo: sólo chequea contra otros pagos (no
    // tiene a mano las facturas). En Supabase el trigger 0037 cubre además el
    // solape con invoices.entry_ids.
    const alreadyPaid = paidEntryIdsFrom(demoPayments)
    if (entryIds.some((id) => alreadyPaid.has(String(id)))) {
      const err = new Error(
        'One or more of these hours are already covered by another payment. Refresh and try again.',
      )
      err.code = 'overlap'
      throw err
    }
    const payment = {
      id: `pay-demo-${Date.now()}`,
      invoiceId: null,
      entryIds: entryIds.map(String),
      userName: payload.userName,
      amountPaid: Number(payload.amountPaid),
      currency: payload.currency ?? 'USD',
      exchangeRate: payload.exchangeRate ?? null,
      paymentDate: payload.paymentDate,
      transferReference: payload.transferReference || null,
      bankMethod: payload.bankMethod || null,
      notes: payload.notes || null,
      backDated,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoPayments = [payment, ...demoPayments]
    return { payment }
  }

  const { data, error } = await supabase
    .from('payments')
    .insert({
      invoice_id: null,
      entry_ids: entryIds,
      user_name: payload.userName,
      amount_paid: Number(payload.amountPaid),
      currency: payload.currency ?? 'USD',
      exchange_rate: payload.exchangeRate ?? null,
      payment_date: payload.paymentDate,
      transfer_reference: payload.transferReference || null,
      bank_method: payload.bankMethod || null,
      notes: payload.notes || null,
      back_dated: backDated,
      created_by: createdBy || null,
    })
    .select(PAYMENT_COLUMNS)
    .single()
  if (error) {
    // El trigger payments_entry_ids_no_overlap rechaza con el SQLSTATE propio
    // 'OV001' cuando alguna hora ya está cubierta por otro pago o una factura. Se
    // matchea por ESE código (no por el texto del mensaje ni un 23505 genérico),
    // así el mapeo no se acopla a la redacción de la excepción.
    if (error.code === 'OV001') {
      const err = new Error(
        'One or more of these hours are already covered by another payment or invoice. Refresh and try again.',
      )
      err.code = 'overlap'
      throw err
    }
    throw new Error(error.message)
  }
  return { payment: rowToPayment(data) }
}

/**
 * Set de ids (string) de horas cubiertas por algún pago — para congelarlas
 * (entryFreeze) y para excluirlas del overage pendiente en Billing.
 * @param {ContractorPayment[]} payments
 * @returns {Set<string>}
 */
export function paidEntryIdsFrom(payments) {
  const set = new Set()
  for (const payment of payments ?? []) {
    for (const id of payment.entryIds ?? []) set.add(String(id))
  }
  return set
}
