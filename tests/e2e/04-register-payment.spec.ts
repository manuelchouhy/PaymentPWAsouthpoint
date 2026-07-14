import { test, expect } from '@playwright/test'
import {
  loginAsTestAdmin,
  billFirstPendingEntry,
  collectInvoice,
  payInvoice,
  cleanupInvoice,
} from './helpers'

test('registrar pago mueve la factura a Paid', async ({ page }) => {
  // 90s: encadena bill + collect + pay, cada uno un round-trip real a
  // Supabase — el default de 45s queda muy justo para las 3 mutaciones
  // reales seguidas (visible sobre todo en Collections/Payments, que
  // no virtualizan sus tablas y tardan más en re-renderizar tras cada una).
  test.setTimeout(90_000)
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
