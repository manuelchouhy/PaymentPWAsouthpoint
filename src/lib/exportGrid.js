import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { formatDateTime } from './format'

function tsFilename(gridName) {
  const now = new Date()
  const d = now.toISOString().slice(0, 10).replace(/-/g, '')
  const t = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  return `contractors_${gridName}_${d}-${t}`
}

// columns: [{ header: string, key: string }]
// rows: plain object array — each row must have all keys used by columns
export function exportGrid({ rows, columns, title, gridName, format, generatedBy = '' }) {
  if (format === 'xlsx') {
    _xlsx({ rows, columns, title, gridName })
  } else if (format === 'pdf') {
    _pdf({ rows, columns, title, gridName, generatedBy })
  }
}

function _xlsx({ rows, columns, title, gridName }) {
  const data = rows.map((r) => {
    const obj = {}
    for (const c of columns) obj[c.header] = r[c.key] ?? ''
    return obj
  })
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  XLSX.writeFile(wb, `${tsFilename(gridName)}.xlsx`)
}

function _pdf({ rows, columns, title, gridName, generatedBy }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const accent = [124, 58, 237]

  doc.setFillColor(10, 10, 10)
  doc.rect(0, 0, pageW, 72, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('SOUTHPOINT TECH LABS', 40, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(180, 180, 185)
  doc.text(title, 40, 56)

  doc.setFontSize(8.5)
  doc.setTextColor(110, 110, 115)
  doc.text(
    `Exported by ${generatedBy || '—'}  ·  ${formatDateTime(new Date().toISOString())}  ·  ${rows.length} rows`,
    40,
    90,
  )

  autoTable(doc, {
    startY: 108,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) =>
      columns.map((c) => {
        const v = r[c.key]
        return v == null ? '' : String(v)
      }),
    ),
    theme: 'striped',
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 7.5, cellPadding: 4 },
  })

  doc.setFontSize(7.5)
  doc.setTextColor(150, 150, 155)
  doc.text(
    `contractors_${gridName} — ${formatDateTime(new Date().toISOString())}`,
    40,
    doc.internal.pageSize.getHeight() - 28,
  )

  doc.save(`${tsFilename(gridName)}.pdf`)
}
