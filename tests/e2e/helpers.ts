import { Page, expect } from '@playwright/test'

declare global {
  interface Window {
    __api?: {
      test: {
        login(): Promise<void>
        cleanupInvoiceChain(invoiceId: string | number): Promise<void>
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
export function testInvoiceNumber() {
  return `PW-TEST-${Date.now()}`
}

export interface BilledInvoice {
  invoiceId: string | number
  invoiceNumber: string
}

/**
 * Selecciona la primera fila pendiente visible en Time Entries y emite una
 * factura de prueba. Devuelve el id y número de la invoice creada, para que
 * el test pueda seguir la cadena (Collection, Payment) y limpiarla al final.
 */
export async function billFirstPendingEntry(page: Page): Promise<BilledInvoice> {
  await page.goto('/time-entries')

  // El checkbox custom superpone un <span> visual sobre el <input> real: ni
  // el click normal ni `force` llegan al input (el hit-test real cae en el
  // span). Se llama al método nativo .click() del elemento directamente, que
  // sí dispara el toggle + evento change de React.
  const checkbox = page.locator('table.table tbody input.checkbox__input').first()
  await checkbox.waitFor({ state: 'visible' })
  await checkbox.evaluate((el) => (el as HTMLInputElement).click())

  await page.getByRole('button', { name: 'Bill', exact: true }).click()

  const invoiceNumber = testInvoiceNumber()
  const modal = page.locator('.modal')
  await modal.locator('#supplier-invoice-number').fill(invoiceNumber)
  await modal.locator('#total-amount').fill('100')
  await modal.locator('#invoice-notes').fill('playwright test')

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/rest/v1/invoices') && res.request().method() === 'POST',
    ),
    modal.getByRole('button', { name: 'Issue invoice' }).click(),
  ])
  const row = await response.json()
  return { invoiceId: row.id, invoiceNumber }
}

/** Va a Collections, encuentra la invoice por número y cobra el total. */
export async function collectInvoice(page: Page, invoiceNumber: string) {
  await page.goto('/collections')
  const row = page.locator('tr', { hasText: invoiceNumber })
  await row.waitFor({ state: 'visible' })
  await row.getByRole('button', { name: 'Register' }).click()

  const modal = page.locator('.modal')
  await modal.locator('#col-ref').fill('PW-COL')

  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/rest/v1/collections') && res.request().method() === 'POST',
    ),
    modal.getByRole('button', { name: 'Register Collection' }).click(),
  ])

  // Por default se ocultan las 'Collected' — activamos el filtro para poder
  // verificar el badge después de cobrar el total.
  const statusFilter = page.locator('.filterfield.msel', { hasText: 'Collection Status' })
  await statusFilter.getByRole('button').click()
  await statusFilter.getByRole('option', { name: 'Collected', exact: true }).click()
  await page.keyboard.press('Escape')
}

/** Va a Payments, encuentra la invoice Collected por número y paga el total. */
export async function payInvoice(page: Page, invoiceNumber: string) {
  await page.goto('/payments')
  const row = page.locator('tr', { hasText: invoiceNumber })
  await row.waitFor({ state: 'visible' })
  await row.getByRole('button', { name: 'Register Payment' }).click()

  const modal = page.locator('.modal')
  await modal.locator('#pay-bank').selectOption('BBVA')
  await modal.locator('#pay-ref').fill('PW-PAY')

  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/rpc/register_contractor_payment')),
    modal.getByRole('button', { name: 'Register Payment' }).click(),
  ])

  // Por default solo se muestran 'Collected' — activamos "Show paid" para
  // poder verificar el badge y descargar el recibo después de pagar.
  await page.getByLabel('Show paid').check()
}

/** Borra la invoice de prueba y sus dependencias directo por la capa de datos (no por la UI). */
export async function cleanupInvoice(page: Page, invoiceId: string | number) {
  await page.evaluate((id) => window.__api?.test.cleanupInvoiceChain(id), invoiceId)
}
