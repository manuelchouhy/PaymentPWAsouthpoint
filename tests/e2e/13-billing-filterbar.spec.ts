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

  // Las 4 dimensiones de Billing, ancladas al span de label con match EXACTO
  // (regex ^label$): 'Project' no debe matchear 'Project #', y no se cuela un value.
  for (const label of ['Client', 'Project #', 'Project', 'Contractor']) {
    await expect(bar.locator('.filterfield__label', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  // Abrir el dropdown de Client (localizado por su label exacto) y tildar la 1ra opción.
  const clientField = bar.locator('.filterfield', { has: page.getByText('Client', { exact: true }) })
  await clientField.locator('.msel__btn').click()
  // Scopeado al panel del campo Client (no page-wide). La base de test tiene clientes.
  const firstOpt = clientField.locator('.msel__panel .msel__opt').first()
  await firstOpt.waitFor({ state: 'visible' })
  await firstOpt.click()
  await page.keyboard.press('Escape') // cerrar el panel para que no tape a Clear

  // Con un filtro activo aparece Clear.
  const clear = bar.locator('.filterbar__clear')
  await expect(clear).toBeVisible()

  // Clear limpia (desaparece).
  await clear.click()
  await expect(clear).toHaveCount(0)
})
