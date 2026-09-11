import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 11 (lote WhatsApp 2026-09-10): las gráficas de Client Summary reflejan la
 * porción "invoiced" (horas ya facturadas al cliente) — una porción del donut de
 * consumido. Respeta los filtros aplicados.
 */
test('Client Summary: el donut muestra la porción "Invoiced" cuando hay horas facturadas', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/client-summary')

  // Las gráficas viven en la sección cs-charts (aparecen con al menos un proyecto en
  // scope, que es el default sin filtros).
  const charts = page.locator('.cs-charts')
  await expect(charts).toBeVisible()

  // La leyenda del donut lista las porciones por nombre. En la data de test hay horas
  // facturadas, así que la porción "Invoiced" tiene que aparecer sin togglear nada.
  const invoicedRow = charts
    .locator('.billing-dist__row')
    .filter({ has: page.locator('.billing-dist__name', { hasText: /^Invoiced$/ }) })
  await expect(invoicedRow).toBeVisible()

  // Su valor es un número de horas > 0 (la porción tiene magnitud real).
  const valText = await invoicedRow.locator('.billing-dist__val').innerText()
  const val = parseFloat(valText)
  expect(val).toBeGreaterThan(0)

  // Y aparece también la porción "Consumed (unbilled)" (el resto del consumido).
  await expect(
    charts.locator('.billing-dist__name', { hasText: 'Consumed (unbilled)' }),
  ).toBeVisible()
})
