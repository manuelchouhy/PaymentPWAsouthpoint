import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, billFirstPendingEntry, collectInvoice, cleanupInvoice } from './helpers'

test('registrar cobro total mueve la factura a Collected', async ({ page }) => {
  await loginAsTestAdmin(page)

  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)

  try {
    await collectInvoice(page, invoiceNumber)

    const row = page.locator('tr', { hasText: invoiceNumber })
    await expect(row).toContainText('Collected')
  } finally {
    await cleanupInvoice(page, invoiceId)
  }
})
