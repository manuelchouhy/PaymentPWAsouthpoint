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
  return /^stage(?![a-z]).+/i.test(String(name ?? '').trim())
}

/**
 * Filtra, de la lista de Tasks de Zoho, las que son Stages.
 * @param {{ id:(string|number), name:string }[]} tasks  Tasks de Zoho normalizadas.
 * @returns {{ zohoTaskId:(string|number), name:string }[]} Stages, en el orden de entrada.
 */
export function detectStages(tasks = []) {
  return tasks
    .filter((t) => isStageName(t.name))
    .map((t) => ({ zohoTaskId: t.id, name: t.name }))
}
