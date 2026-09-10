import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 06 (lote WhatsApp 2026-09-10): el picker "Hours to pay" muestra el estado de
 * cada hora — las pendientes (seleccionables) y las ya pagadas (read-only, badge
 * "Paid", checkbox deshabilitado). Read-only: abre el picker pero NO registra pago.
 */
test('Payments: el picker "Hours to pay" marca cada hora como Pending o Paid', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/payments')

  // Botón que abre el picker por-hora (overage o SP internal).
  const payBtn = page.getByRole('button', { name: /^Pay (overage|SP internal)/ }).first()
  await expect(payBtn).toBeVisible()
  await payBtn.click()

  const picker = page.locator('.overage-picker')
  await expect(picker).toBeVisible()

  const rows = picker.locator('.overage-picker__row')
  await expect(rows.first()).toBeVisible()
  const n = await rows.count()
  expect(n).toBeGreaterThan(0)

  let pending = 0
  let paid = 0
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const badge = (await row.locator('.badge').innerText()).trim()
    expect(['Pending', 'Paid']).toContain(badge)
    const disabled = await row.locator('input[type="checkbox"]').isDisabled()
    if (badge === 'Paid') {
      expect(disabled).toBe(true) // pagadas: read-only, no re-seleccionables
      paid++
    } else {
      expect(disabled).toBe(false) // pendientes: seleccionables
      pending++
    }
  }
  // El picker se abre desde un grupo con horas pendientes → siempre hay al menos una.
  expect(pending).toBeGreaterThan(0)
  console.log(`[slice06] picker: pending=${pending} paid=${paid}`)

  await page.keyboard.press('Escape')
})
