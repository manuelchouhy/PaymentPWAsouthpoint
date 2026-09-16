/**
 * Parser puro del mapa id→key a partir del árbol de Tasks de Zoho (sin red ni
 * Supabase). El `key` legible ("PP1-T1") es lo que se MUESTRA en el front; el `id`
 * interno largo es la llave de join (time_entries.task_number). Ver PRD
 * task-key-display. Espejo del patrón de zohoStageParser.
 */

/**
 * Construye el mapa `{ [idLargo]: keyLegible }` desde las Tasks de Zoho normalizadas.
 * @param {{ id:(string|number), key?:(string|number|null), name?:string }[]} tasks
 *   Tasks de Zoho ya normalizadas (la edge function hace fetch + normaliza el shape crudo).
 *   `id` = id interno largo (anclar); `key` = key legible (mostrar).
 * @returns {Record<string,string>} mapa id→key, solo con tasks que tienen id y key.
 */
export function parseTaskKeyMap(tasks) {
  const map = {}
  // Un input no-array (null/undefined/objeto de normalización fallida upstream) devuelve
  // {} en vez de tirar, igual que detectStages (Array.isArray cubre null y undefined).
  if (!Array.isArray(tasks)) return map
  for (const t of tasks) {
    // Hueco null/undefined en el array (paginación/normalización parcial upstream): saltear.
    if (t == null) continue
    // Sin id (ausente/null/vacío) se omite: no hay a qué anclar el key (el join es por id).
    if (t.id == null || t.id === '') continue
    // Sin key (ausente/null/vacía) se omite: en el front esa fila cae al fallback "—".
    if (t.key == null || t.key === '') continue
    const id = String(t.id)
    // Dedup por id: el key es inmutable, así que ante overlap de paginación el primero
    // gana (mismo criterio que detectStages) y no se pisa con una repetición posterior.
    if (id in map) continue
    map[id] = String(t.key)
  }
  return map
}
