/**
 * COPIA para Deno del parser de Stages. FUENTE DE VERDAD Y TESTS: src/lib/zohoStageParser.js
 * (el edge function no puede importar de src/lib). Mantener ambos en sync — misma lógica.
 *
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
  // `.*[\p{L}\p{N}]` (flag s) exige un alfanumérico real después de "Stage".
  return /^stage(?![\p{L}]).*[\p{L}\p{N}]/ius.test(String(name ?? '').trim())
}

/**
 * Filtra, de la lista de Tasks de Zoho, las que son Stages.
 * @param {{ id:(string|number), key?:(string|number|null), name:string }[]} tasks  Tasks
 *   de Zoho normalizadas. `id` = id interno largo (anclar); `key` = key legible (mostrar).
 * @returns {{ zohoTaskId:string, zohoTaskKey:(string|null), name:string }[]} Stages, en orden.
 */
export function detectStages(tasks) {
  if (!Array.isArray(tasks)) return []
  const seen = new Set()
  const stages = []
  for (const t of tasks) {
    if (t == null || t.id == null || t.id === '' || !isStageName(t.name)) continue
    const zohoTaskId = String(t.id)
    if (seen.has(zohoTaskId)) continue
    seen.add(zohoTaskId)
    stages.push({
      zohoTaskId,
      zohoTaskKey: t.key != null && t.key !== '' ? String(t.key) : null,
      name: String(t.name ?? '').trim(),
    })
  }
  return stages
}
