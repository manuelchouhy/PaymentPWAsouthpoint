import { jsPDF } from 'jspdf'
import { writeFileSync } from 'node:fs'

// ── Contenido del checklist (estado al 2026-06-10) ──────────────────────────
// status: 'done' | 'pending' | 'partial'
const B = []
const h1 = (t) => B.push({ type: 'h1', t })
const h2 = (t) => B.push({ type: 'h2', t })
const note = (t) => B.push({ type: 'note', t })
const it = (status, t, indent = 0) => B.push({ type: 'item', status, t, indent })
const sp = () => B.push({ type: 'sp' })

h1('Contractors System — Estado actual')
note('Cruce contra el SRS v4. Generado 2026-06-10.  [x] hecho · [~] parcial · [ ] pendiente')
sp()

h2('HECHO — Nucleo Billing (prototipo)')
it('done', 'Sync ZOHO, grilla, seleccion, registro de pago, SSO Microsoft, RLS, Postgres Supabase')
sp()

h2('Modulo Billing (FR-01 a FR-06)')
it('done', 'FR-01 Sync ZOHO (Prompt 1): ultimo sync en pantalla, warning + reintentos, backoff, sync log')
it('done', 'FR-02 Columnas (Prompts 2,6): Client, Task #, Week ISO, Billing Status badge 4 estados')
it('done', 'FR-03 Filtros (Prompt 4): Client, Contractor, Project, Status, fechas, Week, Clear, contadores')
it('done', "FR-04 Vistas (Prompt 3): 'Pending to Bill' / 'All' / tabs")
it('done', 'FR-05 Facturacion (Prompt 5): modal Bill, campos, auto-calculo, Invoiced, cancelar, resumen')
it('pending', 'FR-05: warning si el contrato del proyecto esta vencido (no se hizo)', 1)
it('done', 'FR-06 Detalle de factura (Prompt 7): datos, nro/fecha, horas, monto, estado, historial')
sp()

h2('Projects & Contracts + alertas (FR-07, FR-08)')
it('done', 'FR-07 Projects & Contracts (Prompt 8): 12 campos, grilla, filtros, Days Remaining, badges, CRUD, audit')
it('done', 'FR-08 Alertas contrato cliente (Prompt 9): evaluacion, badges, email, umbrales, frecuencia, vinculo billing')
sp()

h2('Collections (FR-09, FR-12)')
it('done', 'FR-09 Collections (Prompt 10): estados, registro de cobro, parcial, desbloqueo de pago, grid, modal')
it('done', 'FR-12 Alerta de cobro pendiente (Prompt 11): aviso, vencido, color de fila, KPI, email, frecuencia')
sp()

h2('Payments (FR-10, FR-13)')
it('done', 'FR-10 Payments (Prompt 12): habilitar solo si Collected, registro, Paid, PDF comprobante, historial, back-dated')
it('done', 'FR-13 Alerta de pago vencido (Prompt 13): aviso, vencido, badge, KPI, email diario, priorizacion')
sp()

h2('Supplier Contracts (FR-14, FR-15, FR-16)')
it('done', 'FR-14 Register (Prompt 14): grilla, campos, badges, PDF link, drawer, filtros, colores, audit, renewal history')
it('done', 'FR-15 Creacion + docs + renovacion (Prompt 15): modal, upload PDF 20MB, Storage seguro, edicion auditada,')
it('done', 'archivar version, historial, workflow Renew, estado Renewal in Progress + snooze', 1)
it('done', 'FR-16 Alertas + prioridad southpointlabs (Prompt 16): umbrales 90/60/30/0, banner no-descartable,')
it('done', "email 'Action Required', widget dashboard, alert history, pantalla de settings", 1)
it('pending', 'FR-16: Export a Excel/PDF de la vista filtrada · Quick link al modulo (no se hicieron)', 1)
sp()

h2('Otros completados')
it('done', 'Los 16 prompts (Fase 1+2+3) ejecutados y commiteados')
it('done', 'Supabase migrado a la base de Claudio · Documento spec entregado')
it('partial', 'Testing Playwright: hecho informalmente en cada validacion (falta suite formal)')
sp()

h1('PENDIENTE (para Martin / Claudio)')

h2('Provisorio / Infraestructura (Claudio)')
it('pending', 'Token dedicado de ZOHO (reemplazar el refresh token reutilizado de Domo)')
it('pending', 'Plan Supabase para produccion (el Free no tiene backups y pausa por inactividad)')
it('pending', 'Estrategia de backup / restore')
it('pending', 'Separar entornos dev / UAT / produccion')
it('pending', 'Gestion de secrets para produccion (SRS 7.2/7.3)')
it('pending', 'Definir hosting de la data de produccion')
it('pending', 'Forzar HTTPS exclusivo con Azure AD y ZOHO')
sp()

h2('FR-11 — Roles SSO (el login ya funciona; falta el resto)')
it('pending', 'Mapeo de grupos de Azure AD a roles (Operations / Finance / Admin)')
it('pending', 'Acumulacion de permisos por multiples grupos')
it('pending', 'Just-in-time provisioning en el primer login')
it('pending', 'Revocar acceso si el usuario se desactiva en Azure AD')
it('pending', "Pantalla 'acceso denegado' para usuarios sin grupo")
it('pending', 'Expiracion de sesion configurable (8h)')
it('pending', 'Authorization Code Flow con PKCE')
sp()

h2('Transversal / No funcional')
it('pending', 'Auditoria unificada de acciones criticas (7.2)')
it('pending', 'Trazabilidad punta a punta hora -> factura -> cobro -> pago (8.4)')
it('partial', 'Dashboard de operaciones (8.1): widgets construidos como componentes, falta la pantalla + KPIs + grafico')
it('pending', 'Export a Excel (.xlsx) y PDF segun vista (8.2)')
it('pending', 'Sistema de notificaciones unificado (8.3)')
it('pending', 'Multi-moneda: moneda + tipo de cambio (8.5)')
it('pending', 'Usabilidad formal: responsive desktop/tablet, confirmaciones (7.4)')
sp()

h2('Proximas tareas')
it('pending', 'Validar criterios de aceptacion')
it('pending', 'Suite de testing Playwright formal')

// ── Render ───────────────────────────────────────────────────────────────────
const doc = new jsPDF({ unit: 'pt', format: 'a4' })
const PW = doc.internal.pageSize.getWidth()
const PH = doc.internal.pageSize.getHeight()
const M = 48
const MAXW = PW - M * 2
let y = M

const COL = {
  done: [22, 163, 74],
  pending: [120, 120, 120],
  partial: [217, 119, 6],
  ink: [20, 20, 20],
  faint: [110, 110, 110],
  accent: [124, 58, 237],
}
const MARK = { done: '[x]', pending: '[ ]', partial: '[~]' }

function ensure(space) {
  if (y + space > PH - M) {
    doc.addPage()
    y = M
  }
}

for (const b of B) {
  if (b.type === 'sp') { y += 6; continue }
  if (b.type === 'h1') {
    ensure(30)
    y += 6
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...COL.accent)
    doc.text(b.t, M, y)
    y += 8
    doc.setDrawColor(...COL.accent).setLineWidth(1)
    doc.line(M, y, PW - M, y)
    y += 14
    continue
  }
  if (b.type === 'h2') {
    ensure(24)
    y += 4
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...COL.ink)
    doc.text(b.t, M, y)
    y += 14
    continue
  }
  if (b.type === 'note') {
    doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...COL.faint)
    const lines = doc.splitTextToSize(b.t, MAXW)
    ensure(lines.length * 11)
    doc.text(lines, M, y)
    y += lines.length * 11 + 2
    continue
  }
  if (b.type === 'item') {
    const indent = (b.indent || 0) * 16
    const markX = M + indent
    const textX = markX + 22
    const tw = PW - M - textX
    doc.setFont('helvetica', 'normal').setFontSize(9.5)
    const lines = doc.splitTextToSize(b.t, tw)
    ensure(lines.length * 12)
    doc.setTextColor(...COL[b.status])
    doc.setFont('helvetica', 'bold')
    doc.text(MARK[b.status], markX, y)
    doc.setFont('helvetica', 'normal').setTextColor(...COL.ink)
    doc.text(lines, textX, y)
    y += lines.length * 12 + 2
    continue
  }
}

const out = 'C:/Users/Lenovo/Downloads/checklist-estado-actual.pdf'
writeFileSync(out, Buffer.from(doc.output('arraybuffer')))
console.log('PDF generado:', out, '· paginas:', doc.getNumberOfPages())
