import { test, expect } from '@playwright/test'
import {
  loginAsTestAdmin,
  billFirstPendingEntry,
  collectInvoice,
  payInvoice,
  cleanupInvoice,
} from './helpers'

test('registrar pago mueve la factura a Paid', async ({ page }) => {
  await loginAsTestAdmin(page)

  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)

  try {
    await collectInvoice(page, invoiceNumber)
    await payInvoice(page, invoiceNumber)

    const row = page.locator('tr', { hasText: invoiceNumber })
    await expect(row).toContainText('Paid')
  } finally {
    await cleanupInvoice(page, invoiceId)
  }
})
