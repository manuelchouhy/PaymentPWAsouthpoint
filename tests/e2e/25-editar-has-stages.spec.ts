import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Fix 2026-09-11: al editar el SOW se puede cambiar si el proyecto tiene stages o no
 * (antes "Has stages?" era read-only en edición). Toggle sin guardar (no muta la DB).
 */
test('Editar SOW: "Has stages?" es editable y muestra/oculta la sección de stages', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const row = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  const modal = page.locator('.modal--carousel')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: /Edit SOW/i }).click()

  // El checkbox "Has stages?" ahora es editable (no un texto read-only).
  const hasStages = page.getByRole('checkbox', { name: 'Has stages?' })
  await expect(hasStages).toBeVisible()
  await expect(hasStages).not.toBeChecked() // Proyecto Prueba arranca sin stages

  const addStage = page.getByRole('button', { name: 'Add stage' })
  await expect(addStage).toHaveCount(0)

  // Activar → aparece la sección de stages.
  await hasStages.check()
  await expect(addStage).toBeVisible()

  // Desactivar → se oculta.
  await hasStages.uncheck()
  await expect(addStage).toHaveCount(0)

  // Cerrar SIN guardar (no muta la DB).
  await page.keyboard.press('Escape')
})
