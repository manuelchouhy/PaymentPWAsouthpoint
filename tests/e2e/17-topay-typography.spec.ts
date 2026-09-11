import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 07 (lote WhatsApp 2026-09-10): tipografía más grande en los selectores del picker
 * "Hours to pay". Read-only: abre el picker y verifica el font-size computado.
 */
test('Payments: los selectores del picker "Hours to pay" tienen tipografía agrandada', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/payments')

  const payBtn = page.getByRole('button', { name: /^Pay (overage|SP internal)/ }).first()
  await expect(payBtn).toBeVisible()
  await payBtn.click()

  const desc = page.locator('.overage-picker__desc').first()
  await expect(desc).toBeVisible()
  // La descripción de cada hora quedó en 14px (antes 12.5px).
  const fontSize = await desc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontSize).toBeGreaterThanOrEqual(14)

  await page.keyboard.press('Escape')
})
