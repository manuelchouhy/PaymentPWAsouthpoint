import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 03 (lote WhatsApp 2026-09-10): la barra de filtros compartida en Payments,
 * con 5 dimensiones (Client, Project #, Project, Contractor, Status). "Status" =
 * estado de PAGO de la factura (Invoiced/Paid). Read-only (no registra pagos).
 */
test('Payments: barra de filtros con 5 dimensiones; Status = Invoiced/Paid; filtra y limpia', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/payments')

  const bar = page.locator('.filterbar')
  await expect(bar).toBeVisible()

  // Las 5 dimensiones.
  for (const label of ['Client', 'Project #', 'Project', 'Contractor', 'Status']) {
    await expect(bar.locator('.filterfield__label', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  // El dropdown Status ofrece Invoiced y Paid.
  const statusField = bar.locator('.filterfield', { has: page.getByText('Status', { exact: true }) })
  await statusField.locator('.msel__btn').click()
  await expect(statusField.getByRole('option', { name: 'Invoiced' })).toBeVisible()
  await expect(statusField.getByRole('option', { name: 'Paid' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Filtrar por Client (1ra opción) hace aparecer Clear; Clear limpia.
  const clientField = bar.locator('.filterfield', { has: page.getByText('Client', { exact: true }) })
  await clientField.locator('.msel__btn').click()
  const firstOpt = clientField.locator('.msel__panel .msel__opt').first()
  await firstOpt.waitFor({ state: 'visible' })
  await firstOpt.click()
  await page.keyboard.press('Escape')

  const clear = bar.locator('.filterbar__clear')
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(clear).toHaveCount(0)
})
