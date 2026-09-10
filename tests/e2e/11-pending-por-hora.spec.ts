import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 06 (lote WhatsApp 2026-09-10): el picker "Hours to pay" marca el estado de
 * cada hora. Read-only: abre el picker pero NO registra el pago (cierra con Escape).
 * Las horas que muestra el picker son las pendientes → todas deben decir "Pending".
 */
test('Payments: el picker "Hours to pay" marca cada hora como Pending', async ({ page }) => {
  await loginAsTestAdmin(page)
  await page.goto('/payments')

  // Botón que abre el picker por-hora (overage o SP internal).
  const payBtn = page.getByRole('button', { name: /^Pay (overage|SP internal)/ }).first()
  await expect(payBtn).toBeVisible()
  await payBtn.click()

  const picker = page.locator('.overage-picker')
  await expect(picker).toBeVisible()

  // Cada hora del picker muestra un badge de estado "Pending".
  const badges = picker.locator('.badge')
  await expect(badges.first()).toBeVisible()
  const count = await badges.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    await expect(badges.nth(i)).toHaveText('Pending')
  }

  await page.keyboard.press('Escape')
})
