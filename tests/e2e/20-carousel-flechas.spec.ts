import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 13 (lote WhatsApp 2026-09-10): flechas del carrusel del pop up de Projects & SOW
 * más intuitivas — nombran el slide destino, se deshabilitan en los extremos (nav no
 * cíclica) y hay indicador de posición N / M.
 */
test('Projects & SOW: las flechas del carrusel navegan y respetan los extremos', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const firstRow = page.locator('table.proj-table tbody tr').first()
  await firstRow.waitFor({ state: 'visible' })
  await firstRow.click()

  const modal = page.locator('.modal--carousel')
  await expect(modal).toBeVisible()

  const prev = modal.locator('.carousel__nav .carousel__arrow').first()
  const next = modal.locator('.carousel__nav .carousel__arrow').last()
  const pos = modal.locator('.carousel__pos')
  const title = modal.locator('.carousel__title')

  // Arranca en el primer slide: prev deshabilitada, posición "1 / M".
  await expect(title).toHaveText('Overview')
  await expect(prev).toBeDisabled()
  await expect(next).toBeEnabled()
  await expect(pos).toHaveText(/^1 \/ \d+$/)

  // El total M de "1 / M".
  const total = Number((await pos.innerText()).split('/')[1].trim())
  expect(total).toBeGreaterThan(1)

  // La flecha "next" nombra el slide destino (el segundo slide).
  await expect(next).toHaveAttribute('aria-label', /^Next section: /)

  // Avanzar hasta el final con la flecha next; en cada paso sube la posición.
  for (let i = 2; i <= total; i++) {
    await next.click()
    await expect(pos).toHaveText(new RegExp(`^${i} \\/ ${total}$`))
  }

  // En el último slide: next deshabilitada, prev habilitada (nav no cíclica).
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()

  // Volver un paso con prev.
  await prev.click()
  await expect(pos).toHaveText(new RegExp(`^${total - 1} \\/ ${total}$`))

  await page.keyboard.press('Escape')
})
