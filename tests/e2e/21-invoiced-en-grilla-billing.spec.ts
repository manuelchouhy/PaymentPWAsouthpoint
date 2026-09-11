import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 10 (lote WhatsApp 2026-09-10): las horas ya facturadas se ven en la grilla de
 * Billing SIN activar el toggle de estado — un badge "X h invoiced" en el header de cada
 * proyecto, siempre visible (incluso con el filtro 'pending' por defecto).
 */
test('Billing: el badge "invoiced" aparece en la grilla sin togglear a Invoiced', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')

  const statusSelect = page.getByLabel('Filter by billing status')
  await expect(statusSelect).toBeVisible()
  // Arranca en la vista por defecto: pendientes (ready to bill).
  await expect(statusSelect).toHaveValue('pending')

  const badges = page.locator('.bill-project__invoiced')

  // En la data de test hay proyectos con horas facturadas Y pendientes, así que el
  // badge tiene que verse en la vista por defecto ('pending') SIN togglear. Este es
  // el corazón del slice: lo facturado presente sin cambiar de vista.
  await expect(badges.first()).toBeVisible()
  await expect(statusSelect).toHaveValue('pending')
  await expect(badges.first()).toHaveText(/[\d.]+\s*h invoiced/)

  const countPending = await badges.count()
  expect(countPending).toBeGreaterThan(0)

  // Consistencia con el toggle: en 'all' aparecen todos los proyectos facturados, así
  // que la cantidad de badges no puede ser menor que en 'pending'.
  await statusSelect.selectOption('all')
  await expect(statusSelect).toHaveValue('all')
  await expect(badges.first()).toBeVisible()
  expect(await badges.count()).toBeGreaterThanOrEqual(countPending)

  // Y volviendo a 'pending' se mantienen (no dependían del toggle).
  await statusSelect.selectOption('pending')
  await expect(statusSelect).toHaveValue('pending')
  await expect(badges).toHaveCount(countPending)
})
