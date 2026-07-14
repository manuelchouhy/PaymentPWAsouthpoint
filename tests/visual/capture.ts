import { Page, expect } from '@playwright/test'
import {
  loginAsTestAdmin,
  billFirstPendingEntry,
  collectInvoice,
  cleanupInvoice,
} from '../e2e/helpers'

/**
 * Recorre las pantallas principales y guarda un screenshot full-page de cada
 * una en outDir. Compartido entre baseline.spec.ts (antes del rediseño) y
 * after.spec.ts (después) para que ambos corran exactamente el mismo path —
 * si divergen, compare.mjs compara peras con manzanas.
 *
 * No hay ruta propia para 404 ni para access-denied en esta app (ver
 * AuthGate.jsx: access-denied depende de permissionsEnforced, que el modo
 * test fuerza a false), así que no se capturan — no hay nada real que
 * mostrar todavía.
 */
export async function captureAllScreens(page: Page, outDir: string) {
  const shot = (name: string) =>
    page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true, timeout: 15_000 })
  // Los overlays de modal/drawer usan backdrop-filter: blur(), que junto con
  // fullPage cuelga el compositor de Chromium headless en este entorno.
  // Los modales/drawers siempre caen dentro del viewport, así que alcanza
  // con un screenshot recortado (no fullPage).
  const shotOverlay = (name: string) =>
    page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false, timeout: 15_000 })
  // Cada página muestra un placeholder "Loading X…" mientras llega el fetch
  // inicial — sin esperar a que desaparezca, el screenshot capta ese estado
  // transitorio en vez del contenido real.
  const waitLoaded = () =>
    page
      .getByText(/^Loading/)
      .first()
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {})

  // 1. Login (sin sesión) — tiene que ser antes de loguear.
  await page.goto('/')
  await shot('01-login')

  await loginAsTestAdmin(page)

  // 2. Dashboard
  await page.goto('/')
  await waitLoaded()
  await shot('02-dashboard')

  // 3. Time Entries sin filtros
  await page.goto('/time-entries')
  await waitLoaded()
  await shot('03-time-entries')

  // 4. Time Entries con filtro (Week acota el dataset de forma determinística)
  await page.locator('input[type="number"]').first().fill('1')
  await shot('04-time-entries-filtered')
  await page.locator('input[type="number"]').first().fill('')

  // 5. Modal Bill abierto
  const checkbox = page.locator('table.table tbody input.checkbox__input').first()
  await checkbox.waitFor({ state: 'visible' })
  await checkbox.evaluate((el) => (el as HTMLInputElement).click())
  await page.getByRole('button', { name: 'Bill', exact: true }).click()
  await expect(page.locator('.modal')).toBeVisible()
  await shotOverlay('05-bill-modal')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal')).toBeHidden()

  // 6. Collections
  await page.goto('/collections')
  await waitLoaded()
  await shot('06-collections')

  // 7. Modal Register Collection abierto
  const registerBtn = page.getByRole('button', { name: 'Register', exact: true }).first()
  await registerBtn.waitFor({ state: 'visible' })
  await registerBtn.click()
  await expect(page.locator('.modal')).toBeVisible()
  await shotOverlay('07-register-collection-modal')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal')).toBeHidden()

  // 8. Payments sin "Show paid"
  await page.goto('/payments')
  await waitLoaded()
  await shot('08-payments')

  // 9. Payments con "Show paid"
  await page.getByLabel('Show paid').check()
  await shot('09-payments-show-paid')
  await page.getByLabel('Show paid').uncheck()

  // No hay ninguna invoice real en estado "Collected" ahora mismo (todas están
  // Invoiced o Paid) — sin una, no hay botón "Register Payment" ni fila para
  // abrir el drawer. Se crea una de prueba, se usa para los pasos 10-11, y se
  // borra al final (misma cadena bill → collect que usan los specs de R2).
  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)
  await collectInvoice(page, invoiceNumber)

  await page.goto('/payments')
  await waitLoaded()
  const testRow = page.locator('tr', { hasText: invoiceNumber })
  await testRow.waitFor({ state: 'visible' })

  // 10. Modal Register Payment abierto
  await testRow.getByRole('button', { name: 'Register Payment', exact: true }).click()
  await expect(page.locator('.modal')).toBeVisible()
  await shotOverlay('10-register-payment-modal')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal')).toBeHidden()

  // 11. Detalle de factura (drawer) — solo se abre desde Time Entries (ver
  // App.jsx; Payments no tiene esa interacción en una fila).
  await page.goto('/time-entries')
  await waitLoaded()
  // La pestaña por defecto es "Pending to bill" — una vez facturada, la
  // entrada solo aparece bajo "All".
  await page.getByRole('tab', { name: /^All/ }).click()
  const timeEntriesRow = page.locator('tr', { hasText: invoiceNumber })
  await timeEntriesRow.waitFor({ state: 'visible' })
  // .click() por coordenadas puede pegarle a la barra sticky de selección que
  // se superpone a la fila (mismo issue que el checkbox del header, ver
  // helpers.ts) — se dispara el .click() nativo del elemento en su lugar.
  await timeEntriesRow.evaluate((el) => (el as HTMLElement).click())
  await expect(page.locator('.drawer')).toBeVisible()
  await shotOverlay('11-invoice-drawer')
  await page.keyboard.press('Escape')

  await cleanupInvoice(page, invoiceId)

  // 12. Projects & Contracts
  await page.goto('/projects')
  await waitLoaded()
  await shot('12-projects')

  // 13. Supplier Contracts
  await page.goto('/supplier-contracts')
  await waitLoaded()
  await shot('13-supplier-contracts')

  // 14. Audit Log
  await page.goto('/audit-log')
  await waitLoaded()
  await shot('14-audit-log')

  // 15-18. Settings (las 4 páginas de alertas — no hay una pantalla "Settings" única)
  await page.goto('/contract-alerts')
  await waitLoaded()
  await shot('15-settings-contract-alerts')
  await page.goto('/collection-alerts')
  await waitLoaded()
  await shot('16-settings-collection-alerts')
  await page.goto('/payment-alerts')
  await waitLoaded()
  await shot('17-settings-payment-alerts')
  await page.goto('/supplier-alerts')
  await waitLoaded()
  await shot('18-settings-supplier-alerts')
}
