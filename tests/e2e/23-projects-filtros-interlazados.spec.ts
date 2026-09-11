import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Fix feedback 2026-09-11: los filtros de Projects & SOW ahora están interlazados
 * (como Billing/Dashboard). Elegir un Client recorta la lista de Project a los
 * proyectos de ese cliente (antes las opciones salían de la lista completa).
 */
async function projectOptions(page: any): Promise<string[]> {
  const field = page
    .locator('.filterfield', { has: page.getByText('Project', { exact: true }) })
    .first()
  await field.locator('.msel__btn').click()
  await field.locator('.msel__opt-label, .msel__empty').first().waitFor({ state: 'visible' })
  const vals = await field.locator('.msel__opt-label').allInnerTexts()
  await page.keyboard.press('Escape')
  return vals
}

test('Projects & SOW: elegir un Client recorta la lista de Project (interlazado)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const clientField = page
    .locator('.filterfield', { has: page.getByText('Client', { exact: true }) })
    .first()
  await clientField.waitFor({ state: 'visible', timeout: 30000 })

  const before = await projectOptions(page)
  expect(before.length).toBeGreaterThan(1)

  // Elegir el primer Client.
  await clientField.locator('.msel__btn').click()
  const firstOpt = clientField.locator('.msel__panel .msel__opt').first()
  await firstOpt.waitFor({ state: 'visible' })
  await firstOpt.click()
  await page.keyboard.press('Escape')

  // La lista de Project se recorta (menos opciones que sin filtro).
  const after = await projectOptions(page)
  expect(after.length).toBeLessThan(before.length)
  expect(after.length).toBeGreaterThan(0)
})
