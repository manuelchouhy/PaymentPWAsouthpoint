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

  // Status ofrece los 4 estados de facturación.
  const statusField = bar.locator('.filterfield', { has: page.getByText('Status', { exact: true }) })
  await statusField.locator('.msel__btn').click()
  for (const s of ['Pending', 'Invoiced', 'Collected', 'Paid']) {
    await expect(statusField.getByRole('option', { name: s })).toBeVisible()
  }
  await page.keyboard.press('Escape')

  // Filtrar por Client hace aparecer Clear; Clear limpia.
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
