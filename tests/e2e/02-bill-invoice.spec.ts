import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, issueGroupedInvoice, contractorRow, cleanupTestInvoices } from './helpers'

// Modelo AGRUPADO en horas (slices 03/04): una factura cubre un cliente + proyecto +
// semana y agrupa a uno o varios contractors. Al emitir sólo se carga el SP invoice
// number; el monto/fecha/supplier# de cada contractor se cargan al pagar (ver spec 04).
test('emitir factura agrupada la deja Invoiced con sus contractors pendientes', async ({ page }) => {
  // Emisión + navegaciones contra Supabase real: holgura sobre el default de 45s.
  test.setTimeout(90_000)
  await loginAsTestAdmin(page)

  let spNumber: string | undefined
  try {
    const issued = await issueGroupedInvoice(page)
    spNumber = issued.spNumber
    const { contractors } = issued
    expect(contractors.length).toBeGreaterThan(0)

    // El aviso confirma la emisión con el conteo de contractors (filtrado por número:
    // el reload posterior agrega un .state__hint transitorio de "Loading…").
    await expect(page.locator('.state__hint').filter({ hasText: spNumber })).toBeVisible()

    // En Payments la factura aparece pagable (Invoiced), 0/N pagados, con una fila
    // Pending por contractor.
    await page.goto('/payments')
    const group = page.locator('tbody.pay-invoice-group', { hasText: spNumber })
    await expect(group).toBeVisible()
    await expect(group.locator('.pay-invoice-head__row')).toContainText('Invoiced')
    await expect(group.locator('.pay-invoice-head__row')).toContainText(
      `0/${contractors.length} paid`,
    )
    for (const name of contractors) {
      await expect(contractorRow(page, group, name)).toContainText('Pending')
    }
  } finally {
    await cleanupTestInvoices(page)
  }
})
