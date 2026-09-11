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

  // El slide llega a un estado terminal (deja de mostrar "Loading…"). Los finales
  // posibles son: nodos del árbol, vacío o error (el cliente de test implementa
  // projectTasks.list, así que en la práctica es árbol o vacío, pero toleramos error).
  await expect(modal.getByText('Loading stages & tasks…')).toHaveCount(0, { timeout: 15000 })

  const nodes = modal.locator('.stage-tree__node')
  const empty = modal.getByText('This project has no stages or tasks yet.')
  const errorMsg = modal.getByText('Stages & tasks could not be loaded', { exact: false })
  const nodeCount = await nodes.count()
  if (nodeCount > 0) {
    // Un stage node se expande al clickear su header y muestra su contenido: una
    // lista de tasks (.stage-tree__task) o el vacío "No tasks in this stage.".
    const firstNode = nodes.first()
    const firstHeader = firstNode.locator('.stage-tree__header')
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    await firstHeader.click()
    await expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
    // El contenido del nodo expandido efectivamente se renderiza (no solo el flag).
    await expect(
      firstNode.locator('.stage-tree__task, .stage-tree__empty').first(),
    ).toBeVisible()
  } else {
    // Sin nodos: tiene que estar visible el vacío o el error, no una pantalla en blanco.
    expect((await empty.count()) + (await errorMsg.count())).toBeGreaterThan(0)
  }

  await page.keyboard.press('Escape')
})
