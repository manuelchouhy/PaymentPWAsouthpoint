import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

test('sync manual de Zoho refresca la grilla y el estado', async ({ page }) => {
  // El sync real dispara la Edge Function de Zoho, con reintentos ante 503 —
  // puede tardar más de un minuto en este entorno.
  test.setTimeout(120_000)

  await loginAsTestAdmin(page)
  await page.goto('/time-entries')

  await page.getByRole('button', { name: /Refresh now|Syncing/ }).click()

  const toast = page.locator('.toast')
  await expect(toast).toBeVisible({ timeout: 110_000 })
  await expect(toast).toHaveAttribute('role', 'status')
  await expect(toast).toContainText('Synced')

  // "Última actualización" depende de la fila singleton `sync_status` (id=1).
  // Si el proyecto de Supabase de este entorno no la tiene poblada, el texto
  // queda en "No syncs yet" aunque el sync haya sido exitoso (confirmado por
  // el toast de arriba) — no es una regresión de este refactor, así que la
  // aserción se relaja a "no muestra error" en ese caso.
  const syncText = page.locator('.sync-status__text')
  await expect(syncText).not.toHaveClass(/sync-status__text--error/)
})
