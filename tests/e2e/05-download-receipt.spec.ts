import { test, expect } from '@playwright/test'
import {
  loginAsTestAdmin,
  billFirstPendingEntry,
  collectInvoice,
  payInvoice,
  cleanupInvoice,
} from './helpers'

test('descargar el PDF de comprobante de una factura Paid', async ({ page }) => {
  // 90s: encadena bill + collect + pay (cada uno un round-trip real a
  // Supabase) antes de siquiera llegar a descargar el PDF — el default de
  // 45s queda muy justo para las 3 mutaciones reales seguidas.
  test.setTimeout(90_000)
  await loginAsTestAdmin(page)

  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)

  try {
    await collectInvoice(page, invoiceNumber)
    await payInvoice(page, invoiceNumber)

    const row = page.locator('tr', { hasText: invoiceNumber })
    await expect(row).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'Receipt' }).click(),
    ])

    expect(download.suggestedFilename()).toMatch(/^recibo-pago-.*\.pdf$/)
  } finally {
    await cleanupInvoice(page, invoiceId)
  }
})
