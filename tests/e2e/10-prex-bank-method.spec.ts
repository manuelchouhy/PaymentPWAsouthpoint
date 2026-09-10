import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, issueGroupedInvoice, cleanupTestInvoices } from './helpers'

/**
 * Slice 08 (lote WhatsApp 2026-09-10): "Prex" como método de pago (bank_method).
 *
 * Crea una factura de test para tener algo pagable, abre el modal de pago del primer
 * contractor y verifica que "Prex" está entre las opciones de "Bank / method". NO
 * registra el pago (cierra con Cancel) → no muta la tabla de payments; la factura de
 * test se limpia en el finally. Es el único chequeo que un unit test no cubre (la
 * opción vive en una constante y se renderiza en un <select>).
 */
test('Payments: "Prex" es una opción del Bank/method en el modal de pago', async ({ page }) => {
  test.setTimeout(120_000)
  await loginAsTestAdmin(page)

  let spNumber: string | undefined
  try {
    const issued = await issueGroupedInvoice(page)
    spNumber = issued.spNumber

    await page.goto('/payments')
    const group = page.locator('tbody.pay-invoice-group', { hasText: spNumber })
    await expect(group).toBeVisible()

    // Abrir el modal de pago del primer contractor (sin registrar el pago).
    await group.locator('button.btn--pay.btn--row').first().click()
    const modal = page.locator('.modal')
    const bank = modal.locator('#pay-bank')
    await expect(bank).toBeVisible()

    // "Prex" está entre las opciones del select.
    await expect(bank.locator('option', { hasText: 'Prex' })).toHaveCount(1)
    // Y es seleccionable (selectOption no tira si el value existe).
    await bank.selectOption('Prex')
    await expect(bank).toHaveValue('Prex')

    // Cerrar sin submit para no mutar payments.
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await modal.waitFor({ state: 'detached' })
  } finally {
    await cleanupTestInvoices(page)
  }
})
