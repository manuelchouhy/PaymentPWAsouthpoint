import { test, expect, type Page } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 05 (lote WhatsApp 2026-09-10): las opciones de los filtros se ENTRELAZAN en
 * todas las páginas (buildFilterOptions cruza las dimensiones). Al tildar un Cliente,
 * el dropdown de Contractor se recorta a los contractors de ese cliente — nunca ofrece
 * un valor que dé cero. Entries/Time Entries ya lo cubre el spec 07; acá se verifica en
 * Billing, Payments y Dashboard (las páginas que usan la barra compartida). Read-only.
 */

// Ancla el .msel por el <span> del label con match exacto (igual que spec 07).
const fieldOf = (page: Page, label: string) =>
  page
    .locator('.msel')
    .filter({ has: page.locator('.filterfield__label', { hasText: new RegExp(`^${label}$`) }) })
    .first()

const optionsOf = async (page: Page, label: string) => {
  const field = fieldOf(page, label)
  await field.locator('.msel__btn').click()
  await expect(field.locator('.msel__opt-label').first()).toBeVisible()
  const values = await field.locator('.msel__opt-label').allInnerTexts()
  await page.keyboard.press('Escape')
  return values
}

// Tildar un Cliente recorta las opciones de Contractor a un SUBCONJUNTO de todas
// (interlazado activo) y nunca ofrece un valor fuera de la lista original; además,
// tildar uno de esos contractors scoped NO deja el resto de las dimensiones en cero
// (la garantía "ninguna combinación da cero" del cruce).
async function assertClientNarrowsContractor(page: Page) {
  const allContractors = await optionsOf(page, 'Contractor')
  expect(allContractors.length, 'el fixture no tiene contractors').toBeGreaterThan(0)

  const client = fieldOf(page, 'Client')
  await client.locator('.msel__btn').click()
  await client.locator('.msel__opt').first().click()
  await page.keyboard.press('Escape')

  const scoped = await optionsOf(page, 'Contractor')
  expect(scoped.length).toBeGreaterThan(0)
  expect(scoped.length).toBeLessThanOrEqual(allContractors.length)
  for (const c of scoped) expect(allContractors).toContain(c)

  // Chequeo FUERTE: tildar un contractor scoped mantiene el cruce coherente — el dropdown
  // de Project sigue ofreciendo al menos una opción (la combinación cliente+contractor NO
  // colapsa a cero, que es justo lo que el interlazado garantiza).
  const contractor = fieldOf(page, 'Contractor')
  await contractor.locator('.msel__btn').click()
  await contractor.locator('.msel__opt').first().click()
  await page.keyboard.press('Escape')
  const scopedProjects = await optionsOf(page, 'Project')
  expect(scopedProjects.length, 'la combinación cliente+contractor no debe dar cero').toBeGreaterThan(0)
}

test('Billing: tildar un Cliente recorta las opciones de Contractor (interlazado)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')
  await expect(page.locator('.filterbar')).toBeVisible()
  await assertClientNarrowsContractor(page)
})

test('Payments: tildar un Cliente recorta las opciones de Contractor (interlazado)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/payments')
  await expect(page.locator('.filterbar')).toBeVisible()
  await assertClientNarrowsContractor(page)
})

test('Dashboard: tildar un Cliente recorta las opciones de Contractor (interlazado)', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/')
  await expect(page.locator('.filterbar')).toBeVisible()
  await assertClientNarrowsContractor(page)
})
