/**
 * Lógica pura de la factura agrupada multi-contractor (medida en HORAS, sin
 * plata). Una factura cubre UN cliente + UN proyecto + UNA semana (dom→sáb) y
 * agrupa a varios contractors; cada contractor aporta sus horas (entry_ids).
 *
 * Módulo sin side-effects (no toca Supabase) para poder testearlo con
 * `node --test`, igual que billingGrouping.js / paymentsGrouping.js. La capa de
 * datos (`data.js#createGroupedInvoice`) usa este builder y sólo hace el I/O.
 */

// Normaliza las entries de un contractor a { entry_ids, hours }, con entry_ids
// numéricos (bigint[] en Supabase, mismo criterio que createInvoice) y sin
// duplicados. hours se suma SÓLO sobre las entries incluidas, y cada entry
// incluida DEBE tener horas finitas: el modelo se mide en horas, así que un
// entry_id sin horas válidas es un error de datos (se rechaza) en vez de quedar
// como una hora incluida que aporta 0 — invoice_contractors.hours nunca diverge
// de sus entry_ids.
function normalizeEntries(entries, contractorName) {
  const seen = new Set()
  const entryIds = []
  let hours = 0
  for (const entry of entries ?? []) {
    const n = typeof entry?.id === 'number' ? entry.id : Number(entry?.id)
    if (!Number.isFinite(n) || seen.has(n)) continue
    // null/undefined se rechazan explícitamente: Number(null) === 0 se colaría
    // como "0 horas válidas" pese a ser un dato ausente. 0 numérico sí es válido.
    const raw = entry?.hours
    const h = Number(raw)
    if (raw == null || !Number.isFinite(h)) {
      throw new Error(`Entry ${n} (${contractorName}) has no valid hours.`)
    }
    seen.add(n)
    entryIds.push(n)
    hours += h
  }
  return { entryIds, hours }
}

/**
 * Construye el payload de una factura agrupada a partir de la selección de la UI.
 *
 * Una factura puede cubrir VARIAS semanas del mismo cliente+proyecto: `weekStart` es
 * el domingo de la PRIMERA semana del período y `weekEnd` el domingo de la ÚLTIMA
 * (ambos son domingos que IDENTIFICAN la semana — week-identifiers, no el último día
 * calendario; el período real termina el sábado de esa última semana). Simétrico con
 * `week_start`; el rango se rotula como etiqueta de semana (WEEK N · año), no como
 * fecha suelta. Con una sola semana el resultado `week_end` queda null —se
 * omita `weekEnd` o venga igual a `weekStart`—, de modo que `week_end is not null`
 * marca inequívocamente una factura multi-semana.
 *
 * @param {{
 *   spInvoiceNumber: string,
 *   project: string,
 *   client?: string,
 *   weekStart?: string,
 *   weekEnd?: string,
 *   notes?: string,
 *   contractors: Array<{ contractor: string, entries: Array<{ id: string|number, hours: number }> }>,
 * }} selection
 * @returns {{
 *   invoice: { sp_invoice_number:string, project:string, client:?string, week_start:?string, week_end:?string, notes:?string, status:'Invoiced', entry_ids:number[] },
 *   contractorRows: Array<{ contractor:string, entry_ids:number[], hours:number }>,
 * }}
 * @throws {Error} con mensaje legible ante selección inválida.
 */
export function buildGroupedInvoicePayload({
  spInvoiceNumber,
  project,
  client,
  weekStart,
  weekEnd,
  notes,
  contractors,
} = {}) {
  const sp = (spInvoiceNumber ?? '').trim()
  if (!sp) {
    throw new Error('SP invoice number is required.')
  }
  const proj = (project ?? '').trim()
  if (!proj) {
    throw new Error('A grouped invoice needs a project.')
  }
  if (!Array.isArray(contractors) || contractors.length === 0) {
    throw new Error('Select at least one contractor to invoice.')
  }

  const contractorRows = []
  // Union de todas las horas de la factura (denormalizado en invoices.entry_ids):
  // el trigger anti-doble-pago 0037 y el entry-freeze leen invoices.entry_ids, así
  // que se mantiene poblado con la union de las filas por-contractor.
  const seen = new Set()
  const entryIdsUnion = []

  for (const row of contractors) {
    const name = (row?.contractor ?? '').trim()
    if (!name) {
      throw new Error('Every selected line needs a contractor.')
    }
    // Dedup dentro del contractor y horas atadas a esas mismas entries.
    const { entryIds, hours } = normalizeEntries(row.entries, name)
    if (entryIds.length === 0) {
      throw new Error(`${name} has no hours selected for this invoice.`)
    }
    for (const id of entryIds) {
      // Una hora pertenece a un solo contractor: si ya la reclamó otra fila, es
      // una selección inconsistente que no se puede facturar.
      if (seen.has(id)) {
        throw new Error(
          `Hour ${id} is assigned to more than one contractor (entry_ids overlap).`,
        )
      }
      seen.add(id)
      entryIdsUnion.push(id)
    }
    contractorRows.push({ contractor: name, entry_ids: entryIds, hours })
  }

  const invoice = {
    sp_invoice_number: sp,
    project: proj,
    client: (client ?? '').trim() || null,
    week_start: weekStart || null,
    // week_end es null para una factura de UNA sola semana (weekEnd ausente o igual a
    // weekStart): así "week_end is not null" es el marcador inequívoco de multi-semana
    // (coincide con el comment de la columna en la migración 0044). Sólo se guarda
    // cuando hay un rango COHERENTE: weekStart presente y weekEnd estrictamente
    // posterior (comparación lexicográfica de 'YYYY-MM-DD' = cronológica). Un end sin
    // start, o un rango invertido (weekEnd < weekStart) —sólo alcanzable por un llamador
    // directo, no por la UI que manda un span ordenado— se degrada a semana única en vez
    // de guardar un rango incoherente.
    week_end: weekStart && weekEnd && weekEnd > weekStart ? weekEnd : null,
    notes: (notes ?? '').trim() || null,
    status: 'Invoiced',
    entry_ids: entryIdsUnion,
  }

  return { invoice, contractorRows }
}
