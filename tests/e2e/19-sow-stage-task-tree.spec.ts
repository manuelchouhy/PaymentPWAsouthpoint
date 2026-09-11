import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 12 (lote WhatsApp 2026-09-10): el pop up de Projects & SOW tiene un slide
 * "Stages & Tasks" con vista de árbol (stages expandibles con sus tasks anidados).
 * Hoy los tasks no tienen stageId en el schema, así que caen bajo "Sin stage".
 */
test('Projects & SOW: el pop up muestra el slide "Stages & Tasks" con árbol expandible', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const firstRow = page.locator('table.proj-table tbody tr').first()
  await firstRow.waitFor({ state: 'visible' })
  await firstRow.click()

  const modal = page.locator('.modal--carousel')
  await expect(modal).toBeVisible()

  // Navegar al slide via el dot del carrusel (aria-label = label del slide).
  await modal.getByRole('tab', { name: 'Stages & Tasks' }).click()
  await expect(modal.locator('.carousel__title')).toHaveText('Stages & Tasks')

  // El slide termina de cargar y muestra el árbol (uno o más nodos de stage) o,
  // si el proyecto no tiene stages ni tasks, el vacío. En ambos casos NO queda en
  // "Loading stages…".
  await expect(modal.getByText('Loading stages…')).toHaveCount(0, { timeout: 15000 })

  const nodes = modal.locator('.stage-tree__node')
  const empty = modal.getByText('This project has no stages or tasks yet.')
  const nodeCount = await nodes.count()
  if (nodeCount === 0) {
    await expect(empty).toBeVisible()
  } else {
    // Un stage node se expande al clickear su header y muestra sus tasks (o el
    // vacío "No tasks in this stage.").
    const firstHeader = nodes.first().locator('.stage-tree__header')
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    await firstHeader.click()
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
  }

  await page.keyboard.press('Escape')
})
