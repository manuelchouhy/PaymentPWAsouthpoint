/**
 * Parser puro de Stages a partir del árbol de Tasks de Zoho (sin red ni Supabase).
 * Un Stage es una Task de Zoho cuyo nombre se llama "Stage" + algo. Ver CONTEXT.md.
 */

/**
 * ¿El nombre de una Task de Zoho corresponde a un Stage?
 * @param {*} name
 * @returns {boolean}
 */
export function isStageName(name) {
  // "Stage" como palabra (no seguida de otra letra → excluye "Staging"/"Staged"/
  // "Stagehand") y con algo después (el "+ algo" → "Stage" pelado no cuenta). El
  // separador puede ser espacio, número o símbolo: "Stage II", "Stage2", "Stage-2 QA".
  // `\p{L}` (flag u) excluye cualquier letra, no solo ASCII (ej. "Stageño" no es Stage).
  // `.*[\p{L}\p{N}]` (flag s) exige un alfanumérico real después de "Stage": un
  // separador suelto ("Stage:", "Stage -") no alcanza; el `s` permite que ese separador
  // sea un newline. LIMITACIÓN CONOCIDA (ver PRD "Riesgo principal"): la heurística por
  // nombre puede dar falsos positivos con cualquier task que empiece con "Stage" + un
  // separador + algo (ej. "Stage 2 servers", "Stage-gate review"); se acepta porque el
  // usuario nombra los stages como "Stage N". Si molesta, se podría exigir número/romano
  // tras "Stage" (decisión de producto pendiente).
  return /^stage(?![\p{L}]).*[\p{L}\p{N}]/ius.test(String(name ?? '').trim())
}

/**
 * Filtra, de la lista de Tasks de Zoho, las que son Stages.
 * @param {{ id:(string|number), key?:(string|number|null), name:string }[]} tasks  Tasks
 *   de Zoho normalizadas. `id` = id interno largo (anclar); `key` = key legible (mostrar).
 * @returns {{ zohoTaskId:string, zohoTaskKey:(string|null), name:string }[]} Stages, en orden.
 */
export function detectStages(tasks) {
  // Un input no-array (ej. normalización fallida upstream que pasa null) devuelve []
  // en vez de tirar (Array.isArray cubre null y undefined, no solo undefined).
  if (!Array.isArray(tasks)) return []
  const seen = new Set()
  const stages = []
  for (const t of tasks) {
    // Se saltea (no tira): hueco null en el array, o Stage sin id de Zoho (id ausente/
    // vacío) que es inusable porque el upsert/diff se ancla por zoho_task_id.
    if (t == null || t.id == null || t.id === '' || !isStageName(t.name)) continue
    // `zohoTaskId` a string (la columna es TEXT, como time_entries.task_number) → el diff
    // del sync compara con === sin mismatch número-vs-string.
    const zohoTaskId = String(t.id)
    // Dedup por id: si Zoho repite la misma Task-Stage (overlap de paginación), emitirla
    // dos veces reventaría el índice único (project_id, zoho_task_id) del upsert.
    if (seen.has(zohoTaskId)) continue
    seen.add(zohoTaskId)
    stages.push({
      zohoTaskId,
      // key legible ("PP1-T5") para mostrar en el front; null si no vino o vino vacía.
      zohoTaskKey: t.key != null && t.key !== '' ? String(t.key) : null,
      // name trimeado: cumple el contrato { name:string } y limpia el stage_name a guardar.
      name: String(t.name ?? '').trim(),
    })
  }
  return stages
}
