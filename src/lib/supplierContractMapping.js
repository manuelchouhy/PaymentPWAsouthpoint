/**
 * Mapeo puro fila DB ↔ dominio de Supplier Contracts (FR-14). Sin dependencias
 * de Supabase ni de red — vive aparte de supplierContractsData.js para poder
 * testearse aislado con `node --test` (mismo patrón que projectStatus.js).
 */

/** Campos editables ↔ columnas, para el UPDATE/INSERT y la auditoría. */
export const FIELD_TO_COLUMN = {
  supplierName: 'supplier_name',
  isPrioritySupplier: 'is_priority_supplier',
  contractNumber: 'contract_number',
  role: 'role',
  startDate: 'start_date',
  expirationDate: 'expiration_date',
  renewalDate: 'renewal_date',
  paymentTerms: 'payment_terms',
  renewalType: 'renewal_type',
  weeklyContractedHours: 'weekly_contracted_hours',
}

/** Fila de Supabase → objeto de dominio. */
export function rowToContract(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    isPrioritySupplier: Boolean(row.is_priority_supplier),
    contractNumber: row.contract_number,
    role: row.role ?? null,
    startDate: row.start_date,
    expirationDate: row.expiration_date,
    renewalDate: row.renewal_date,
    paymentTerms: row.payment_terms,
    renewalType: row.renewal_type,
    status: row.status,
    // Number(): PostgREST puede serializar numeric como string para no perder
    // precisión; sin la coerción, sumar horas en Capacidad concatenaría en
    // vez de sumar (mismo patrón que amountReceived/amountPaid/etc.).
    weeklyContractedHours:
      row.weekly_contracted_hours == null ? null : Number(row.weekly_contracted_hours),
    pdfUrl: row.pdf_url ?? null,
    archived: Boolean(row.archived),
    parentContractId: row.parent_contract_id ?? null,
    snoozeUntil: row.snooze_until ?? null,
    previousStatus: row.previous_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

/**
 * Objeto de dominio → fila de Supabase (solo los campos presentes). Solo `role`
 * (columna nullable, texto libre) normaliza '' → null para no guardar cadenas
 * vacías. NO se generaliza a todos los textos: supplier_name / contract_number /
 * payment_terms / renewal_type son NOT NULL, y coercionarlos a null convertiría
 * un valor requerido vacío en una violación de constraint (23502) en vez del
 * comportamiento previo de guardar ''. La validación del form ya bloquea vacíos
 * en los requeridos; esta coerción es defensa solo para el campo opcional.
 */
export function contractToRow(c) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (c[field] === undefined) continue
    row[column] = field === 'role' && c[field] === '' ? null : c[field]
  }
  return row
}
