import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, billFirstPendingEntry, cleanupInvoice } from './helpers'

test('emitir factura (Bill) marca la entrada como Invoiced', async ({ page }) => {
  await loginAsTestAdmin(page)

  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)

  try {
    await expect(page.getByRole('status')).toContainText('Invoice issued')

    const row = page.locator('tr', { hasText: invoiceNumber })
    await expect(row).toContainText('Invoiced')

    await row.click()
    const drawer = page.locator('.drawer')
    await expect(drawer.locator('#invoice-drawer-title')).toHaveText(invoiceNumber)
    // Formato es-AR usa coma decimal (100,00) — solo verificamos el monto, no el separador.
    await expect(drawer.locator('.drawer__amount')).toContainText('100')
  } finally {
    await cleanupInvoice(page, invoiceId)
  }
})
