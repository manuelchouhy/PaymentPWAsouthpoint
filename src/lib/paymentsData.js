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

// Métodos de pago (bank_method): en un módulo puro para poder unit-testearlos.
export { BANK_METHODS } from './bankMethods'

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
    // Supplier invoice number POR PAGO (contractor → SouthPoint), 0052: con pago parcial una
    // línea tiene varios pagos, cada uno con su comprobante. Modelo en HORAS (sin monto).
    supplierInvoiceNumber: row.supplier_invoice_number ?? null,
    paymentDate: row.payment_date,
    transferReference: row.transfer_reference ?? null,
    bankMethod: row.bank_method ?? null,
    notes: row.notes ?? null,
    backDated: Boolean(row.back_dated),
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

// Columnas de un pago. Sin plata (amount_paid/currency/exchange_rate): el modelo es en horas.
// El supplier# vive POR PAGO en payments.supplier_invoice_number (0052, pago parcial).
// ⚠️ ORDEN DE DEPLOY: supplier_invoice_number sólo existe tras aplicar la migración 0052. Este
// frontend NO se puede deployar antes que la migración: payments.list() lo lee y varias páginas
// (Payments/Billing/Dashboard/Entries) fallarían con "column does not exist". Deployar la feature
// atómica: migración 0052 PRIMERO, luego el frontend (slices 03/04/05).
const PAYMENT_COLUMNS =
  'id, invoice_id, entry_ids, user_name, supplier_invoice_number, payment_date, transfer_reference, bank_method, notes, back_dated, created_at, created_by'

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

/**
 * UN pago (el más reciente) asociado a una factura, o null. ⚠️ Con pago parcial (ADR 0005) una
 * factura tiene VARIOS pagos (por contractor y por período), así que esto devuelve uno arbitrario;
 * NO usar como "el pago" de la factura. Sin consumidor vivo hoy; la UI de parciales (slice 05) lee
 * la lista completa de payments, no esta función.
 */
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
 * Registra el pago PARCIAL de UN contractor bajo una factura agrupada (modelo en horas,
 * ADR 0005). El pago cubre un SUBCONJUNTO de las horas de la línea (el período elegido en el
 * picker) o todas ("Total"), con su supplier invoice number POR PAGO. La RPC
 * `register_contractor_payment` (0052) inserta el pago con esos entry_ids + supplier#, y avanza
 * la factura a `Paid` de forma ATÓMICA sólo cuando TODAS las horas de la factura están cubiertas.
 * Sin monto/moneda. Las horas cubiertas quedan congeladas (no re-pagables).
 *
 * Manejo de CARRERA/estado: la RPC/trigger tiran errores legibles que acá se mapean a un `code`
 * estable ('already_paid' / 'not_payable' / 'stale' / 'validation') para que la UI muestre el
 * aviso y ofrezca recargar. OV001 (horas ya cubiertas por otro pago) → 'already_paid'.
 *
 * @param {{ id:string|number, invoiceId:string|number, contractor:string, entryIds:Array<string|number>, hours:number }} invoiceContractor
 *   la fila `invoice_contractors` a pagar (viene de getInvoiceContractors).
 * @param {{ entryIds?:Array<string|number>, supplierInvoiceNumber:string, paymentDate:string,
 *           transferReference?:string, bankMethod?:string, notes?:string }} payload
 *   `entryIds` = las horas seleccionadas a cubrir (el bucket de período). Si falta, se cubre toda
 *   la línea ("Total").
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
  // Horas a cubrir: las seleccionadas (bucket de período) o toda la línea ("Total"). bigint[] en
  // la DB: se descartan ids no numéricos (igual que createInvoice/createOveragePayment).
  // entry_ids = time_entries.id (serial/identity interno, ~1.6M hoy), NO el zoho_log_id: está muy
  // por debajo de 2^53, así que Number() no pierde precisión.
  const rawIds = payload.entryIds ?? invoiceContractor.entryIds ?? []
  const entryIds = [...new Set(rawIds.map(Number).filter(Number.isFinite))]
  if (entryIds.length === 0) {
    const err = new Error('Select at least one hour to pay.')
    err.code = 'validation'
    throw err
  }
  const backDated = payload.paymentDate < todayISO()

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    // Demo: replica los guards de la RPC/trigger para no divergir de prod.
    // Línea ya paga al modo legacy (payment_id seteado; sus horas pueden no estar en ningún
    // entry_ids de pago) → no se re-paga (prod: contractor_already_paid). Cubre el caso de un
    // pago demo con entryIds:[] (MOCK_PAYMENTS) que paidEntryIdsFrom no vería.
    if (invoiceContractor.paymentId != null) {
      const err = new Error('Those hours were already paid. Refresh to see the latest status.')
      err.code = 'already_paid'
      throw err
    }
    const idStrs = entryIds.map(String)
    const lineIds = (invoiceContractor.entryIds ?? []).map(String)
    // Subset: las horas a pagar deben pertenecer a la línea (prod: entry_ids_not_in_line).
    const lineSet = new Set(lineIds)
    if (!idStrs.every((id) => lineSet.has(id))) {
      const err = new Error('Invalid payment (hours not in this contractor line).')
      err.code = 'validation'
      throw err
    }
    // Anti doble-pago: ninguna hora ya cubierta por otro pago (prod: trigger OV001). Mismo
    // criterio que createOveragePayment demo (paidEntryIdsFrom sobre los pagos locales).
    const alreadyPaid = paidEntryIdsFrom(demoPayments)
    if (idStrs.some((id) => alreadyPaid.has(id))) {
      const err = new Error('Those hours were already paid. Refresh to see the latest status.')
      err.code = 'already_paid'
      throw err
    }
    // El pago cubre las horas SELECCIONADAS. El avance a Paid y el progreso parcial los deriva la
    // UI recomputando invoiceCompletion por cobertura de entry_ids; sólo se marca la fila paga
    // por link si cubre TODA la línea (para preservar el display demo del caso "Total").
    const payment = {
      id: `pay-demo-${Date.now()}`,
      invoiceId: invoiceContractor.invoiceId,
      entryIds: idStrs,
      userName: invoiceContractor.contractor,
      supplierInvoiceNumber: supplier,
      paymentDate: payload.paymentDate,
      transferReference: payload.transferReference || null,
      bankMethod: payload.bankMethod || null,
      notes: payload.notes || null,
      backDated,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoPayments = [payment, ...demoPayments]
    // Cobertura ACUMULADA (todos los pagos demo, ya incluido el recién agregado): una línea
    // pagada en varios parciales igual se marca paga por link al completar el último.
    const covered = paidEntryIdsFrom(demoPayments)
    const coversWholeLine = lineIds.length > 0 && lineIds.every((id) => covered.has(id))
    if (coversWholeLine) {
      markDemoInvoiceContractorPaid(invoiceContractor.id, {
        paymentId: payment.id,
        supplierInvoiceNumber: supplier,
        paymentDate: payload.paymentDate,
      })
    }
    return { payment }
  }

  // Registro ATÓMICO en el servidor (register_contractor_payment, 0052): inserta el pago con los
  // entry_ids seleccionados + supplier#, y flipea la factura a Paid sólo cuando TODAS sus horas
  // están cubiertas.
  const { data, error } = await supabase.rpc('register_contractor_payment', {
    p_invoice_contractor_id: invoiceContractor.id,
    p_entry_ids: entryIds,
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
    // OV001 = el trigger payments_entry_ids_no_overlap rechazó horas ya cubiertas por otro pago
    // (doble-pago / carrera). Se matchea por el SQLSTATE propio (no por el texto), igual que
    // createOveragePayment, para no acoplarse a la redacción. `contractor_already_paid` es la
    // excepción de la RPC (línea legacy ya paga) → mismo aviso.
    if (error.code === 'OV001' || msg.includes('contractor_already_paid')) {
      const err = new Error('Those hours were already paid. Refresh to see the latest status.')
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
    // Guards de la RPC que el cliente NO chequea antes (supplier# y entry_ids no-vacío sí se
    // validan arriba, así que esos mensajes no llegan acá): fecha faltante, subconjunto fuera de
    // la línea, o línea sin entry_ids.
    if (
      msg.includes('payment_date required') ||
      msg.includes('entry_ids_not_in_line') ||
      msg.includes('invoice_contractor_no_entries')
    ) {
      const err = new Error('Invalid payment (check the hours and supplier invoice number).')
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
