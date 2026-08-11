/**
 * Parser del archivo de SOW (.docx, template fijo `SP-SoW_TemplateENG_v2`).
 * Todo corre en el browser (JSZip + DOMParser) — no hay backend para esto.
 *
 * El template es una serie de tablas de 2 columnas (Campo | Valor). Leemos
 * word/document.xml, juntamos todas las filas de todas las tablas en un mapa
 * label→valor, y de ahí sacamos los campos que le interesan a la pestaña
 * Alcance: N.º de SOW, Estimated Start/End y Estimated Hours.
 *
 * Nunca tira si algo no matchea — devuelve null en ese campo y una entrada en
 * `warnings`, porque el dato se puede (y a veces se tiene que) completar a
 * mano.
 */

import JSZip from 'jszip'

const LABEL_MAP = {
  'sow number': 'sowNumber',
  'estimated start': 'periodStart',
  'estimated end': 'periodEnd',
  'estimated hours': 'budgetHours',
}

function textOfCell(cellNode) {
  const runs = cellNode.getElementsByTagName('w:t')
  let text = ''
  for (let i = 0; i < runs.length; i++) text += runs[i].textContent
  return text.trim()
}

/** @returns {Map<string,string>} label (lowercase, trim) -> valor (texto crudo) */
function extractLabeledRows(xmlDoc) {
  const map = new Map()
  const tables = xmlDoc.getElementsByTagName('w:tbl')
  for (let t = 0; t < tables.length; t++) {
    const rows = tables[t].getElementsByTagName('w:tr')
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].getElementsByTagName('w:tc')
      if (cells.length < 2) continue
      const label = textOfCell(cells[0]).toLowerCase()
      const value = textOfCell(cells[1])
      if (label && value) map.set(label, value)
    }
  }
  return map
}

/** "620 hrs (see breakdown...)" -> 620. Devuelve null si no encuentra un número. */
function parseHours(raw) {
  const match = raw?.match(/[\d,]+(\.\d+)?/)
  if (!match) return null
  const n = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Fechas en el SOW son texto libre (lo completa una persona en Word) — best effort. */
function parseDate(raw) {
  if (!raw) return null
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  const yyyy = parsed.getFullYear()
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Placeholders sin completar del template, ej. "[TOTAL] hrs" o "[DATE]". */
function looksLikePlaceholder(raw) {
  return !raw || /\[[A-Z .]+\]/.test(raw)
}

/**
 * @param {File} file
 * @returns {Promise<{
 *   sowNumber: ?string, periodStart: ?string, periodEnd: ?string, budgetHours: ?number,
 *   warnings: string[],
 * }>}
 */
export async function parseSowDocument(file) {
  const warnings = []
  const result = { sowNumber: null, periodStart: null, periodEnd: null, budgetHours: null, warnings }

  let xml
  try {
    const zip = await JSZip.loadAsync(file)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('not a docx')
    xml = await entry.async('string')
  } catch {
    warnings.push('No pudimos leer el archivo — no parece un .docx válido. Completá los campos a mano.')
    return result
  }

  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml')
  const rows = extractLabeledRows(xmlDoc)

  for (const [label, field] of Object.entries(LABEL_MAP)) {
    const raw = rows.get(label)
    if (looksLikePlaceholder(raw)) {
      warnings.push(`No encontramos "${label}" en el documento (o el campo del template no se completó) — revisalo a mano.`)
      continue
    }
    if (field === 'budgetHours') result.budgetHours = parseHours(raw)
    else if (field === 'periodStart' || field === 'periodEnd') result[field] = parseDate(raw)
    else result[field] = raw
  }

  return result
}
