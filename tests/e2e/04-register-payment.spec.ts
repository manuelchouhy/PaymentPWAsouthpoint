import { test, expect } from '@playwright/test'
import {
  loginAsTestAdmin,
  issueGroupedInvoice,
  payAllContractors,
  showPaidInvoices,
  contractorRow,
  cleanupTestInvoices,
} from './helpers'

// Pago POR CONTRACTOR (slice 04): cada contractor de una factura agrupada se paga por
// separado (supplier# + fecha, en horas). La factura pasa a Paid ATÓMICAMENTE recién
// cuando TODOS sus contractors están pagados (RPC register_contractor_payment, 0040).
test('pagar todos los contractors mueve la factura agrupada a Paid', async ({ page }) => {
  // Emisión + un pago (modal + RPC) por contractor contra Supabase real: una semana con
  // varios contractors supera fácil el default de 45s. Holgura explícita.
  test.setTimeout(120_000)
  await loginAsTestAdmin(page)

  let spNumber: string | undefined
  try {
    const issued = await issueGroupedInvoice(page)
    spNumber = issued.spNumber
    const { contractors } = issued

    await payAllContractors(page, spNumber)

    // Las Paid se ocultan por defecto: activar "Show paid" para verificar el estado final.
    await showPaidInvoices(page)
    const group = page.locator('tbody.pay-invoice-group', { hasText: spNumber })
    await expect(group).toBeVisible()
    const head = group.locator('.pay-invoice-head__row')
    await expect(head).toContainText('Paid')
    await expect(head).toContainText(`${contractors.length}/${contractors.length} paid`)

    // Cada contractor quedó Paid con su supplier# y ofrece descargar el recibo.
    for (const name of contractors) {
      const row = contractorRow(page, group, name)
      await expect(row).toContainText('Paid')
      await expect(row.getByRole('button', { name: 'Receipt' })).toBeVisible()
    }

    // Descargar el recibo de un contractor pagado produce un PDF por-contractor
    // (recupera la cobertura del viejo spec 05, ahora sobre el modelo agrupado).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      group.getByRole('button', { name: 'Receipt' }).first().click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^recibo-pago-.*\.pdf$/)
  } finally {
    await cleanupTestInvoices(page)
  }
})
