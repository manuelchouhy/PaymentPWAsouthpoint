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
  // nombre puede dar falsos positivos si una task común empieza con "Stage <n> ..."
  // (ej. "Stage 2 servers"); se acepta porque el usuario nombra los stages como "Stage N".
  return /^stage(?![\p{L}]).*[\p{L}\p{N}]/ius.test(String(name ?? '').trim())
}

/**
 * Filtra, de la lista de Tasks de Zoho, las que son Stages.
 * @param {{ id:(string|number), name:string }[]} tasks  Tasks de Zoho normalizadas.
 * @returns {{ zohoTaskId:(string|number), name:string }[]} Stages, en el orden de entrada.
 */
export function detectStages(tasks) {
  // Un input no-array (ej. normalización fallida upstream que pasa null) devuelve []
  // en vez de tirar — el default `= []` solo cubre undefined, no null.
  if (!Array.isArray(tasks)) return []
  return tasks
    // `t != null`: tolera huecos en el array (se saltea la fila mala, no tira).
    // id ausente/vacío: un Stage sin id de Zoho es inusable (el upsert/diff se ancla por
    // zoho_task_id) → se descarta en vez de emitir un anchor vacío.
    .filter((t) => t != null && t.id != null && t.id !== '' && isStageName(t.name))
    // `zohoTaskId` a string (la columna zoho_task_id es TEXT, como time_entries.task_number):
    // así el diff del sync compara con === sin mismatch número-vs-string. `name` trimeado
    // cumple el contrato { name:string } y limpia el stage_name a guardar.
    .map((t) => ({ zohoTaskId: String(t.id), name: String(t.name ?? '').trim() }))
}
