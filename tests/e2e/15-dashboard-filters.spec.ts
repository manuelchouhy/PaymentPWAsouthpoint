import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 04 (lote WhatsApp 2026-09-10): barra de filtros compartida en el Dashboard,
 * 5 dimensiones (Client/Project #/Project/Contractor/Status). "Status" = estado de
 * facturación de la hora (Pending/Invoiced/Collected/Paid). Filtra los widgets de
 * horas (donuts, Pending Hours, total). Read-only.
 */
test('Dashboard: barra de filtros con 5 dimensiones; Status = billing status; filtra y limpia', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/')

  const bar = page.locator('.filterbar')
  await expect(bar).toBeVisible()

  for (const label of ['Client', 'Project #', 'Project', 'Contractor', 'Status']) {
    await expect(bar.locator('.filterfield__label', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  // El filtro CAMBIA un widget: Status='Paid' → las horas pagadas no son facturables-
  // pendientes, así que "Pending Hours" pasa a 0.0 (aserción determinística de que el
  // filtro efectivamente acota los widgets de horas).
  const pendingValue = page
    .locator('.dash-kpi', { hasText: 'Pending Hours' })
    .locator('.dash-kpi__value')
  await expect(pendingValue).toBeVisible()

  const statusField = bar.locator('.filterfield', { has: page.getByText('Status', { exact: true }) })
  await statusField.locator('.msel__btn').click()
  for (const s of ['Pending', 'Invoiced', 'Collected', 'Paid']) {
    await expect(statusField.getByRole('option', { name: s })).toBeVisible()
  }
  await statusField.getByRole('option', { name: 'Paid' }).click()
  await page.keyboard.press('Escape')

  await expect(pendingValue).toContainText('0.0')

  // Clear limpia (y desaparece).
  const clear = bar.locator('.filterbar__clear')
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(clear).toHaveCount(0)
})
