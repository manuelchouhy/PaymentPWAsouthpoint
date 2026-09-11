import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Fix 2026-09-11: al editar el SOW se puede cambiar si el proyecto tiene stages o no
 * ("Has stages?" pasó de read-only a editable), y el SOW File de un stage es OPCIONAL.
 * Todo se prueba sin guardar (no muta la DB). State-agnostic: no asume el estado inicial
 * de has_stages del proyecto (el usuario puede haberlo cambiado).
 */
test('Editar SOW: "Has stages?" es editable, muestra/oculta stages y el SOW File es opcional', async ({
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

  const hasStages = page.getByRole('checkbox', { name: 'Has stages?' })
  await expect(hasStages).toBeVisible()
  // Editable (no read-only) — se espera a que carguen los stages (queda enabled).
  await expect(hasStages).toBeEnabled()

  const addStage = page.getByRole('button', { name: 'Add stage' })

  // Asegurar stages ON (sin asumir el estado inicial).
  if (!(await hasStages.isChecked())) await hasStages.check()
  await expect(hasStages).toBeChecked()
  await expect(addStage).toBeVisible()

  // Agregar un stage nuevo: su "SOW File" es OPCIONAL (label 'optional', no 'required').
  await addStage.click()
  const sowFileLabel = page.locator('label[for^="wz-stage-sow-file-"]').last()
  await expect(sowFileLabel).toContainText('SOW File')
  await expect(sowFileLabel).toContainText('optional')
  await expect(sowFileLabel.locator('.field__req')).toHaveCount(0)

  // Toggle OFF → se oculta la sección de stages.
  await hasStages.uncheck()
  await expect(addStage).toHaveCount(0)

  // Cerrar SIN guardar (no muta la DB).
  await page.keyboard.press('Escape')
})
