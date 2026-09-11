import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 2 (link task↔stage): en el paso Tasks del wizard hay una columna "Stage" con un
 * dropdown por task. Asignar una task a un stage PERSISTE (stage_id) y el árbol la muestra
 * bajo ese stage. Se prueba en "Proyecto Prueba" (tiene el stage "hola" y la task "hola").
 * Es idempotente (asigna al mismo stage; re-correr setea el mismo valor).
 */
async function openTasksStep(page: any) {
  const row = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()
  const modal = page.locator('.modal--carousel')
  await modal.getByRole('button', { name: /Edit SOW/i }).click()
  await expect(page.getByRole('checkbox', { name: 'Has stages?' })).toBeEnabled()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Next/i }).click()
  await expect(page.locator('.wizard-steps__item.is-active')).toContainText('Tasks')
}

test('Editar SOW · Tasks: asignar una task a un stage persiste y se ve anidada en el árbol', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')
  await openTasksStep(page)

  // La fila de la task "hola": su dropdown de Stage. Elegir el stage "hola".
  const holaRow = page.locator('tr', { has: page.locator('input[value="hola"]') }).first()
  const stageSelect = holaRow.getByRole('combobox', { name: 'Stage' })
  await expect(stageSelect).toBeVisible()
  await stageSelect.selectOption({ label: 'hola' })

  await page.getByRole('button', { name: /Save changes/i }).click()
  // El wizard cierra al guardar OK.
  await expect(page.locator('.wizard-steps')).toHaveCount(0, { timeout: 15000 })

  // Reabrir el proyecto y ver el árbol: la task "hola" cae bajo el stage "hola".
  await page.goto('/projects')
  const row2 = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row2.waitFor({ state: 'visible', timeout: 30000 })
  await row2.click()
  const modal = page.locator('.modal--carousel')
  await modal.getByRole('tab', { name: 'Stages & Tasks' }).click()
  await expect(modal.getByText('Loading stages & tasks…')).toHaveCount(0, { timeout: 15000 })

  const holaStageNode = modal.locator('.stage-tree__node', {
    has: page.locator('.stage-tree__label', { hasText: /^hola$/ }),
  })
  await expect(holaStageNode).toBeVisible()
  // El stage "hola" ya no está en "0 tasks".
  await expect(holaStageNode.locator('.stage-tree__count')).not.toHaveText('0 tasks')
  // Expandir y confirmar que la task "hola" está adentro.
  await holaStageNode.locator('.stage-tree__header').click()
  await expect(
    holaStageNode.locator('.stage-tree__task-name-text', { hasText: /^hola$/ }),
  ).toBeVisible()
})
