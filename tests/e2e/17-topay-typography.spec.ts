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

  const picker = page.locator('.overage-picker')
  await expect(picker).toBeVisible()

  const fontSizeOf = (sel: string) =>
    picker
      .locator(sel)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

  // Los 3 selectores quedaron más grandes (antes: title 9.5, desc 12.5, hours 12).
  expect(await fontSizeOf('.overage-picker__title')).toBeGreaterThanOrEqual(11)
  expect(await fontSizeOf('.overage-picker__desc')).toBeGreaterThanOrEqual(14)
  expect(await fontSizeOf('.overage-picker__hours')).toBeGreaterThanOrEqual(13)

  await page.keyboard.press('Escape')
})
