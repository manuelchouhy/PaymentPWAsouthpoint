import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 02 (lote WhatsApp 2026-09-10): la barra de filtros de Billing se extrajo al
 * componente compartido <EntryFilterBar>. Refactor sin cambio de comportamiento:
 * la barra debe seguir renderizando sus 4 dimensiones, filtrar y limpiar. Read-only.
 */
test('Billing: la barra de filtros compartida renderiza, filtra y limpia', async ({ page }) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')

  const bar = page.locator('.filterbar')
  await expect(bar).toBeVisible()

  // Las 4 dimensiones de Billing (match EXACTO: 'Project' no debe matchear 'Project #').
  for (const label of ['Client', 'Project #', 'Project', 'Contractor']) {
    await expect(bar.getByText(label, { exact: true })).toBeVisible()
  }

  // Abrir el dropdown de Client y tildar la primera opción.
  const clientField = bar.locator('.filterfield').filter({ hasText: 'Client' })
  await clientField.locator('.msel__btn').click()
  const firstOpt = page.locator('.msel__panel .msel__opt').first()
  await firstOpt.waitFor({ state: 'visible' })
  await firstOpt.click()

  // Con un filtro activo aparece Clear.
  const clear = bar.locator('.filterbar__clear')
  await expect(clear).toBeVisible()

  // Clear limpia (desaparece).
  await clear.click()
  await expect(clear).toHaveCount(0)
})
