import { Page, Locator, expect } from '@playwright/test'

declare global {
  interface Window {
    __api?: {
      test: {
        login(): Promise<void>
        cleanupInvoiceChain(invoiceId: string | number): Promise<void>
        cleanupTestInvoices(): Promise<void>
      }
    }
  }
}

/** Entra por /test-login (VITE_TEST_MODE) — sin pasar por el SSO real. */
export async function loginAsTestAdmin(page: Page) {
  await page.goto('/test-login')
  await expect(page).toHaveURL('/')
  // Ambigüedad: "PW Test Admin" ahora también aparece en el user menu del
  // header (Fase 5) — se ancla al sidebar, que siempre lo muestra sin recorte.
  await expect(page.locator('.sidebar__user').getByText('PW Test Admin')).toBeVisible()
}

/** Prefijo de datos de prueba (convención acordada en el README). */
export function testSpInvoiceNumber() {
  return `PW-TEST-${Date.now()}`
}

export interface GroupedInvoice {
  spNumber: string
  contractors: string[]
}

/**
 * Emite una factura AGRUPADA (modelo en horas, slice 03/04) desde Billing.
 *
 * Expande el primer cliente facturable → primer proyecto → primera semana y
 * selecciona TODAS sus filas: por construcción de la grilla (billingGrouping),
 * las filas de una misma semana comparten cliente + proyecto + semana, así que la
 * selección es siempre válida para `canBillSelection` (uno o varios contractors).
 * Devuelve el SP invoice number de prueba y los contractors que el modal listó.
 *
 * Los checkboxes de fila son un control custom (un <span> tapa el <input> real),
 * así que se dispara el .click() nativo del input por evaluate — igual que el resto
 * de la app. Los toggles de proyecto/semana y los campos de texto sí son estándar.
 */
export async function issueGroupedInvoice(page: Page): Promise<GroupedInvoice> {
  await page.goto('/billing')
  await page.getByText('Pending to bill').first().waitFor()

  // (1) Elegir + expandir el primer cliente facturable y su primer proyecto. Devuelve
  // cliente + proyecto para SCOPEAR los pasos siguientes a ESE proyecto (no al primer
  // .bill-week del documento, que con el seed puede ser de otro proyecto).
  const target = await page.evaluate(() => {
    const clientSec = [...document.querySelectorAll('.bill-client')].find(
      (s) => !s.classList.contains('bill-client--unassigned') && s.querySelector('.bill-project__toggle'),
    )
    if (!clientSec) return null
    const clientName = clientSec.querySelector('.bill-client__name')?.textContent?.trim() ?? ''
    const projToggle = clientSec.querySelector('.bill-project__toggle') as HTMLButtonElement | null
    if (!projToggle) return null
    const projLabel = projToggle.querySelector('.bill-project__label')?.textContent?.trim() ?? ''
    if (projToggle.getAttribute('aria-expanded') !== 'true') projToggle.click()
    return { clientName, projLabel }
  })
  if (!target) {
    throw new Error('No billable client/project in the Billing grid (all hours unassigned?).')
  }

  // Esperar (determinista, sin asumir el timing del re-render) a que el proyecto expandido
  // en el paso 1 haya renderizado su toggle de semana antes de intentar abrirlo.
  await page.waitForFunction(({ clientName, projLabel }) => {
    const clientSec = [...document.querySelectorAll('.bill-client')].find(
      (s) => s.querySelector('.bill-client__name')?.textContent?.trim() === clientName,
    )
    const proj =
      clientSec &&
      [...clientSec.querySelectorAll('.bill-project')].find(
        (p) => p.querySelector('.bill-project__label')?.textContent?.trim() === projLabel,
      )
    return Boolean(proj?.querySelector('.bill-week__toggle'))
  }, target)

  // (2) Expandir la primera semana DE ESE proyecto. El proyecto se re-localiza por cliente
  // + label (un evaluate no comparte referencias DOM con el otro).
  await page.evaluate(({ clientName, projLabel }) => {
    const clientSec = [...document.querySelectorAll('.bill-client')].find(
      (s) => s.querySelector('.bill-client__name')?.textContent?.trim() === clientName,
    )
    const proj =
      clientSec &&
      [...clientSec.querySelectorAll('.bill-project')].find(
        (p) => p.querySelector('.bill-project__label')?.textContent?.trim() === projLabel,
      )
    const weekToggle = proj?.querySelector('.bill-week__toggle') as HTMLButtonElement | null
    if (weekToggle && weekToggle.getAttribute('aria-expanded') !== 'true') weekToggle.click()
  }, target)

  // Esperar a que la semana abierta haya renderizado sus filas con checkbox antes de
  // seleccionar (evita el fallo intermitente de "0 filas" si el render no flusheó).
  await page.waitForFunction(({ clientName, projLabel }) => {
    const clientSec = [...document.querySelectorAll('.bill-client')].find(
      (s) => s.querySelector('.bill-client__name')?.textContent?.trim() === clientName,
    )
    const proj =
      clientSec &&
      [...clientSec.querySelectorAll('.bill-project')].find(
        (p) => p.querySelector('.bill-project__label')?.textContent?.trim() === projLabel,
      )
    const week = proj ? proj.querySelector('.bill-week') : null
    return Boolean(week?.querySelector('tbody input.checkbox__input'))
  }, target)

  // (3) Seleccionar las filas de la primera semana de ese proyecto (ya renderizadas). Es
  // la semana que el toggle abrió (weeks[0], la más reciente).
  const selected = await page.evaluate(({ clientName, projLabel }) => {
    const clientSec = [...document.querySelectorAll('.bill-client')].find(
      (s) => s.querySelector('.bill-client__name')?.textContent?.trim() === clientName,
    )
    const proj =
      clientSec &&
      [...clientSec.querySelectorAll('.bill-project')].find(
        (p) => p.querySelector('.bill-project__label')?.textContent?.trim() === projLabel,
      )
    const week = proj ? proj.querySelector('.bill-week') : null
    if (!week) return 0
    const boxes = [...week.querySelectorAll('tbody input.checkbox__input')] as HTMLInputElement[]
    boxes.forEach((b) => {
      if (!b.checked) b.click()
    })
    return boxes.length
  }, target)
  expect(selected, 'the first billable week should have selectable rows').toBeGreaterThan(0)

  const sendBtn = page.locator('.selbar button.btn--pay', { hasText: 'Send to billing' })
  await expect(sendBtn).toBeEnabled()
  await sendBtn.click()

  const modal = page.locator('.modal')
  await expect(modal.locator('#sp-invoice-number')).toBeVisible()
  const contractors = (await modal.locator('.modal__contractor-name').allInnerTexts()).map((c) =>
    c.trim(),
  )

  const spNumber = testSpInvoiceNumber()
  await modal.locator('#sp-invoice-number').fill(spNumber)

  const [resp] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/rpc/create_grouped_invoice') && res.request().method() === 'POST',
    ),
    modal.getByRole('button', { name: 'Issue invoice' }).click(),
  ])
  // waitForResponse matchea cualquier status: si la emisión falló (validación, carrera,
  // RLS) el aviso no aparece y el expect de abajo timeoutearía con un error ambiguo. Se
  // afirma el 2xx acá para fallar con el status real (simétrico con payAllContractors).
  expect(resp.ok(), `create_grouped_invoice failed with HTTP ${resp.status()}`).toBeTruthy()
  // Tras emitir, handleConfirmBill recarga la grilla → aparece un 2do .state__hint
  // transitorio ("Loading billing data…"). Se filtra por el número para apuntar sólo
  // al aviso de emisión y evitar el strict-mode violation.
  await expect(page.locator('.state__hint').filter({ hasText: spNumber })).toBeVisible()

  return { spNumber, contractors }
}

/**
 * En Payments, paga contractor por contractor la factura del SP number dado.
 * Cada pago hace re-render, así que el locator se re-consulta en cada vuelta.
 * Cuando se paga el último contractor, la RPC flipea la factura a Paid y el grupo
 * desaparece de la vista (las Paid se ocultan salvo "Show paid") → el loop termina.
 */
export async function payAllContractors(page: Page, spNumber: string) {
  await page.goto('/payments')
  const group = page.locator('tbody.pay-invoice-group', { hasText: spNumber })
  await expect(group).toBeVisible()

  let paid = 0
  // Cota de seguridad muy por encima de cualquier cantidad realista de contractors por
  // factura (una semana de un proyecto): sólo evita un loop infinito si el botón nunca
  // desaparece. El fin normal es el break de abajo cuando no quedan botones de pago.
  const MAX_CONTRACTORS = 50
  for (; paid < MAX_CONTRACTORS; paid++) {
    // Botón de pago por-contractor: btn--pay + btn--row (el de recibo es btn--ghost).
    const payBtn = group.locator('button.btn--pay.btn--row').first()
    if ((await payBtn.count()) === 0) break
    await payBtn.click()

    const modal = page.locator('.modal')
    await modal.locator('#pay-supplier').fill(`SUP-PWTEST-${paid}`)
    const [resp] = await Promise.all([
      // Filtrar por POST: Supabase es cross-origin, así que cada RPC lleva un preflight
      // OPTIONS (204) que también aparece como response; sin el filtro, ese 204 podría
      // resolver el waitForResponse y su resp.ok() daría true tapando un POST fallido.
      page.waitForResponse(
        (res) =>
          res.url().includes('/rpc/register_contractor_payment') &&
          res.request().method() === 'POST',
      ),
      modal.locator('button.btn--pay[type="submit"]').click(),
    ])
    // waitForResponse matchea cualquier status: si la RPC falló (carrera, already_paid,
    // validación) el modal queda abierto y el waitFor de abajo colgaría hasta el timeout
    // con un error ambiguo. Se afirma el 2xx acá para fallar con el status real.
    expect(resp.ok(), `register_contractor_payment failed with HTTP ${resp.status()}`).toBeTruthy()
    await modal.waitFor({ state: 'detached' })
  }
  // Si no se pagó a NADIE (selector drifteó, o el grupo no tenía filas pagables) el
  // fallo debe ser claro acá, no un timeout ambiguo en el assert de 'Paid' del spec.
  expect(paid, 'payAllContractors should have paid at least one contractor').toBeGreaterThan(0)
}

/**
 * Fila de un contractor dentro del grupo de una factura en Payments. Matchea por CELDA
 * EXACTA (rol cell = <td>), no por substring de la fila: así no choca con nombres que se
 * contienen entre sí (p. ej. "Ana" vs "Ana Maria") ni con el head row de la factura (cuyo
 * texto concatena proyecto/cliente y nunca es exactamente el nombre de un contractor).
 */
export function contractorRow(page: Page, group: Locator, name: string): Locator {
  return group.locator('tr').filter({ has: page.getByRole('cell', { name, exact: true }) })
}

/** Activa "Show paid" en Payments para ver las facturas ya pagadas. */
export async function showPaidInvoices(page: Page) {
  const toggle = page.getByLabel('Show paid')
  if (!(await toggle.isChecked())) await toggle.check()
}

/**
 * Borra TODAS las facturas de prueba (PW-TEST-%) y sus dependencias por la capa de datos
 * (no por la UI). Sweep global: reclama también residuo de una corrida anterior que falló
 * antes de limpiar. Seguro bajo workers:1 (ver playwright.config.ts / supabase-client.js).
 */
export async function cleanupTestInvoices(page: Page) {
  await page.evaluate(() => window.__api?.test.cleanupTestInvoices())
}
