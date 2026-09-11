import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Fix feedback 2026-09-11: el cuadro #2 de Billing ("Selected + consumed / budget")
 * aparece también al SELECCIONAR filas de un proyecto (antes sólo al filtrar por un
 * proyecto). Tildar una fila de un proyecto muestra selected + consumed / budget.
 */
test('Billing: el cuadro budget se llena al seleccionar una fila de un proyecto (sin filtro)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')

  const card = page.locator('.dash-kpi', { hasText: 'Selected + consumed / budget' })
  await expect(card).toBeVisible()
  // Sin filtro ni selección arranca en "—".
  await expect(card.locator('.dash-kpi__value')).toHaveText('—')

  // Tildar la primera fila-hoja (aria-label "Select <user> · <project>"): una sola
  // fila pertenece a un único proyecto.
  const rowCheckbox = page.getByRole('checkbox', { name: /^Select .+ · .+/ }).first()
  await rowCheckbox.waitFor({ state: 'visible', timeout: 20000 })
  await rowCheckbox.check()

  // El cuadro deja de ser "—" y muestra el formato selected + consumed / budget.
  await expect(card.locator('.dash-kpi__value')).not.toHaveText('—')
  await expect(card.locator('.dash-kpi__value')).toContainText('+')
  await expect(card.locator('.dash-kpi__value')).toContainText('/')
})
