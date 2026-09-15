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
  // LIMITACIÓN CONOCIDA (ver PRD "Riesgo principal"): la heurística por nombre puede dar
  // falsos positivos si una task común empieza con "Stage <n> ..." (ej. "Stage 2 servers");
  // se acepta porque el usuario nombra los stages como "Stage N" por convención.
  return /^stage(?![\p{L}]).+/iu.test(String(name ?? '').trim())
}

/**
 * Filtra, de la lista de Tasks de Zoho, las que son Stages.
 * @param {{ id:(string|number), name:string }[]} tasks  Tasks de Zoho normalizadas.
 * @returns {{ zohoTaskId:(string|number), name:string }[]} Stages, en el orden de entrada.
 */
export function detectStages(tasks = []) {
  return tasks
    // `t != null`: tolera huecos en el array (una normalización fallida upstream no
    // debe tirar toda la detección — se saltea la fila mala).
    .filter((t) => t != null && isStageName(t.name))
    .map((t) => ({ zohoTaskId: t.id, name: t.name }))
}
