/**
 * Capa de datos del módulo Payments al contractor (FR-10), modelo AGRUPADO en HORAS
 * (slice 04d). Una factura `Invoiced` agrupa a varios contractors (invoice_contractors);
 * se le paga a CADA UNO por separado bajo la misma factura, y la factura pasa a `Paid`
 * recién cuando todos están pagados. Sin plata: el pago se mide en horas (entry_ids).
 *
 * @typedef {Object} ContractorPayment
 * @property {string|number} id
 * @property {string|number} invoiceId
 * @property {Array<string>} entryIds     horas cubiertas (overage/sp_internal); NULL→[] bajo factura
 * @property {?string} userName           contractor pagado
 * @property {string} paymentDate         ISO YYYY-MM-DD
 * @property {?string} transferReference
 * @property {?string} bankMethod
 * @property {?string} notes
 * @property {boolean} backDated
 * @property {string} createdAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { paidEntryIdsFrom } from './paymentsGrouping'
import { markDemoInvoiceContractorPaid } from './data'

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
    entryIds: [],
    userName: null,
    paymentDate: '2026-05-25',
    supplierInvoiceNumber: 'SUP-4471',
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
    // Horas que cubre el pago (entry_ids) y a quién se le pagó (user_name). En un pago
    // por-contractor bajo factura, entry_ids queda NULL (las horas viven en
    // invoices.entry_ids / invoice_contractors); en overage/sp_internal trae las horas.
    entryIds: (row.entry_ids ?? []).map(String),
    userName: row.user_name ?? null,
    // El supplier invoice number (contractor → SouthPoint) NO vive en payments: se
    // guarda en la fila invoice_contractors del pago (0040). La UI lo toma de ahí.
    // Modelo en HORAS: sin amount_paid/currency/exchange_rate (se dropean en 0041).
    paymentDate: row.payment_date,
    transferReference: row.transfer_reference ?? null,
    bankMethod: row.bank_method ?? null,
    notes: row.notes ?? null,
    backDated: Boolean(row.back_dated),
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

// Columnas de un pago. Sin plata (amount_paid/currency/exchange_rate): el modelo es en
// horas. El supplier# vive en invoice_contractors, no acá.
const PAYMENT_COLUMNS =
  'id, invoice_id, entry_ids, user_name, payment_date, transfer_reference, bank_method, notes, back_dated, created_at, created_by'

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
 * Registra el pago de UN contractor bajo una factura agrupada (modelo 04d, en horas).
 * Cada contractor de la factura se paga por separado: se carga su supplier invoice
 * number + fecha (+ operativos) y la RPC `register_contractor_payment` (0040) inserta
 * el pago, enlaza la fila `invoice_contractors` y avanza la factura a `Paid` de forma
 * ATÓMICA sólo cuando TODOS sus contractors están pagados. Sin monto/moneda.
 *
 * Manejo de CARRERA: si la fila ya fue pagada, o la factura ya no está `Invoiced`
 * (otro usuario pagó al último contractor primero), la RPC tira un error legible y acá
 * se mapea a un `code` estable ('already_paid' / 'not_payable' / 'stale') para que la
 * UI muestre el aviso y ofrezca recargar.
 *
 * @param {{ id:string|number, invoiceId:string|number, contractor:string, entryIds:Array<string|number>, hours:number }} invoiceContractor
 *   la fila `invoice_contractors` a pagar (viene de getInvoiceContractors).
 * @param {{ supplierInvoiceNumber:string, paymentDate:string, transferReference?:string, bankMethod?:string, notes?:string }} payload
 * @param {?string} createdBy
 * @returns {Promise<{ payment: ContractorPayment }>}
 */
export async function createPayment(invoiceContractor, payload, createdBy) {
  const supplier = (payload.supplierInvoiceNumber ?? '').trim()
  if (!supplier) {
    const err = new Error('Supplier invoice number is required.')
    err.code = 'validation'
    throw err
  }
  const backDated = payload.paymentDate < todayISO()

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    // Demo: el pago cubre las horas del contractor (entry_ids de su fila). El avance a
    // Paid lo decide la UI recomputando invoiceCompletion sobre los pagos locales.
    const payment = {
      id: `pay-demo-${Date.now()}`,
      invoiceId: invoiceContractor.invoiceId,
      entryIds: (invoiceContractor.entryIds ?? []).map(String),
      userName: invoiceContractor.contractor,
      paymentDate: payload.paymentDate,
      transferReference: payload.transferReference || null,
      bankMethod: payload.bankMethod || null,
      notes: payload.notes || null,
      backDated,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoPayments = [payment, ...demoPayments]
    // Persistir el pago en el store demo de invoice_contractors (supplier# + fecha +
    // link), como haría la RPC en prod, para que sobreviva a una recarga de Payments.
    markDemoInvoiceContractorPaid(invoiceContractor.id, {
      paymentId: payment.id,
      supplierInvoiceNumber: supplier,
      paymentDate: payload.paymentDate,
    })
    return { payment }
  }

  // Registro ATÓMICO en el servidor (register_contractor_payment, 0040): inserta el
  // pago del contractor, completa su fila invoice_contractors (supplier# + fecha +
  // payment_id) y flipea la factura a Paid sólo si NINGUNA fila hija queda sin pagar.
  const { data, error } = await supabase.rpc('register_contractor_payment', {
    p_invoice_contractor_id: invoiceContractor.id,
    p_supplier_invoice_number: supplier,
    p_payment_date: payload.paymentDate,
    p_transfer_reference: payload.transferReference || null,
    p_bank_method: payload.bankMethod || null,
    p_notes: payload.notes || null,
    p_back_dated: backDated,
    p_created_by: createdBy || null,
  })
  if (error) {
    const msg = error.message ?? ''
    // Carreras y estados: se mapean por el texto de la excepción de la RPC (0040), no
    // por SQLSTATE genérico, para dar un aviso claro + opción de recargar.
    if (msg.includes('contractor_already_paid')) {
      const err = new Error('This contractor was already paid. Refresh to see the latest status.')
      err.code = 'already_paid'
      throw err
    }
    if (msg.includes('invoice_not_payable')) {
      const err = new Error(
        'This invoice is no longer payable (its status changed). Refresh and try again.',
      )
      err.code = 'not_payable'
      throw err
    }
    if (msg.includes('invoice_contractor_not_found') || msg.includes('invoice_not_found')) {
      const err = new Error('This invoice or contractor no longer exists. Refresh the page.')
      err.code = 'stale'
      throw err
    }
    if (msg.includes('supplier invoice number is required')) {
      const err = new Error('Supplier invoice number is required.')
      err.code = 'validation'
      throw err
    }
    throw new Error(msg)
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
 * Modelo en HORAS (slice 05): el pago overage/sp_internal queda definido por su
 * contractor + entry_ids (horas), sin monto/moneda.
 *
 * @param {{ userName:string, entryIds:Array<string|number>, paymentDate:string, transferReference?:string, bankMethod?:string, notes?:string }} payload
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

// Set de ids (string) de horas cubiertas por algún pago — para congelarlas
// (entryFreeze) y para excluirlas del pendiente invoice-less en Billing. La
// implementación canónica vive en el módulo puro paymentsGrouping.js (testeable
// bajo node --test); se re-exporta acá para no romper los imports existentes.
export { paidEntryIdsFrom }
