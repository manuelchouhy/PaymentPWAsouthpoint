import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, billFirstPendingEntry, cleanupInvoice } from './helpers'

test('emitir factura con un supplier invoice number ya usado se bloquea', async ({ page }) => {
  await loginAsTestAdmin(page)

  const { invoiceId, invoiceNumber } = await billFirstPendingEntry(page)

  try {
    const result = await page.evaluate(async (number) => {
      try {
        await (window as any).__api.invoices.create({
          supplierInvoiceNumber: number,
          invoiceDate: '2026-01-01',
          totalAmount: 1,
          userName: 'Playwright Duplicate Test',
          entryIds: [],
        })
        return { threw: false }
      } catch (error: any) {
        return { threw: true, message: error?.message, code: error?.code }
      }
    }, invoiceNumber)

    expect(result.threw).toBe(true)
    expect(result.code).toBe('duplicate')
    expect(result.message).toBe(
      'That supplier invoice number already exists. Please use a different one.',
    )
  } finally {
    await cleanupInvoice(page, invoiceId)
  }
})
