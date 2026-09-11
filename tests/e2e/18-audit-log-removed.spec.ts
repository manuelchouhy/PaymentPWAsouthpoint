import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 14 (lote WhatsApp 2026-09-10): se sacó la sección "Audit log" de los pop ups
 * (Projects & SOW y Supplier Contracts). La página AuditLog standalone se mantiene.
 * Read-only.
 */
test('Projects & SOW: el pop up del proyecto ya no muestra "Audit log"', async ({ page }) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const firstRow = page.locator('table.proj-table tbody tr').first()
  await firstRow.waitFor({ state: 'visible' })
  await firstRow.click()

  const modal = page.locator('.modal').first()
  await expect(modal).toBeVisible()
  // El modal renderiza (tiene contenido) pero NO la sección Audit log.
  await expect(modal.getByText('Audit log', { exact: true })).toHaveCount(0)

  await page.keyboard.press('Escape')
})

test('Supplier Contracts: el pop up del contrato ya no muestra "Audit log" (pero sí las otras secciones)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/supplier-contracts')

  const firstRow = page.locator('table.proj-table tbody tr').first()
  await firstRow.waitFor({ state: 'visible' })
  await firstRow.click()

  const modal = page.locator('.modal--supplier-detail')
  await expect(modal).toBeVisible()
  // Se sacó el Audit log, pero se mantienen las secciones de dominio.
  await expect(modal.getByText('Audit log', { exact: true })).toHaveCount(0)
  await expect(modal.getByText('Alert history', { exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
})
