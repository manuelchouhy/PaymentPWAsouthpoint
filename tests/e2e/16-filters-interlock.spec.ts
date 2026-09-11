import { test, expect, type Page } from '@playwright/test'
import { loginAsTestAdmin, fieldOf, optionsOf } from './helpers'

/**
 * Slice 05 (lote WhatsApp 2026-09-10): SMOKE de wiring del interlazado. Confirma que la
 * barra de filtros COMPARTIDA está cableada en cada página con opciones cruzadas
 * (buildFilterOptions): al tildar un Cliente, el dropdown de Contractor se recalcula a un
 * subconjunto de sus opciones (nunca un valor fuera de la lista original) y sigue con al
 * menos una opción. La LÓGICA del cruce (que ninguna combinación de dos listas dé cero) la
 * cubre en profundidad el spec 07 sobre el MISMO buildFilterOptions; acá sólo se verifica
 * que Billing/Payments/Dashboard lo usan (Entries/Time Entries ya están en el 07). Read-only.
 */

// Tildar un Cliente recalcula las opciones de Contractor a un SUBCONJUNTO de todas
// (interlazado cableado), sin ofrecer un valor fuera de la lista original.
async function assertClientScopesContractor(page: Page) {
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
}

for (const { name, path } of [
  { name: 'Billing', path: '/billing' },
  { name: 'Payments', path: '/payments' },
  { name: 'Dashboard', path: '/' },
]) {
  test(`${name}: la barra compartida cablea el interlazado (Cliente recorta Contractor)`, async ({
    page,
  }) => {
    await loginAsTestAdmin(page)
    await page.goto(path)
    await expect(page.locator('.filterbar')).toBeVisible()
    await assertClientScopesContractor(page)
  })
}
