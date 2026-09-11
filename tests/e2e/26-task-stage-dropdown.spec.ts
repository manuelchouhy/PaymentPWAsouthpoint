import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 2 (link task↔stage): en el paso Tasks del wizard de Edit SOW hay una columna
 * "Stage" con un dropdown por task para elegir a qué stage (ya guardado) va. Se prueba en
 * "Proyecto Prueba" (tiene stages). UI, sin guardar (no muta la DB).
 */
test('Editar SOW · Tasks: hay columna Stage con dropdown para asignar cada task a un stage', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')
  const row = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()
  const modal = page.locator('.modal--carousel')
  await modal.getByRole('button', { name: /Edit SOW/i }).click()

  // Esperar a que cargue el wizard (checkbox Has stages? enabled).
  await expect(page.getByRole('checkbox', { name: 'Has stages?' })).toBeEnabled()

  // Navegar hasta el paso Tasks (Next x3).
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Next/i }).click()
  await expect(page.locator('.wizard-steps__item.is-active')).toContainText('Tasks')

  // Hay una columna "Stage" y al menos un dropdown de stage con la opción "No stage".
  await expect(page.getByRole('columnheader', { name: 'Stage' })).toBeVisible()
  const stageSelect = page.getByRole('combobox', { name: 'Stage' }).first()
  await expect(stageSelect).toBeVisible()
  await expect(stageSelect.locator('option', { hasText: 'No stage' })).toHaveCount(1)
  // Hay al menos una opción de stage real además de "No stage".
  expect(await stageSelect.locator('option').count()).toBeGreaterThan(1)

  await page.keyboard.press('Escape')
})
