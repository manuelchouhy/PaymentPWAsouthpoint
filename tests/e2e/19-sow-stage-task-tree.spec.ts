import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 12 (lote WhatsApp 2026-09-10) + fix 2026-09-11: el pop up de Projects & SOW tiene
 * un slide "Stages & Tasks" con vista de árbol. Los tasks son los REALES del proyecto (los
 * distintos `task` de sus horas cargadas en Zoho, con horas), NO los del scope del SOW
 * (project_tasks, casi siempre vacío). Como no hay link stage↔task, los tasks caen bajo el
 * nodo "Tasks".
 */
test('Projects & SOW: el slide "Stages & Tasks" muestra los tasks reales del proyecto con horas', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  // "Proyecto Prueba" no tiene filas en project_tasks pero sí horas cargadas con 2 tasks
  // (Task 2 = 5 h, Task 3 = 8 h): el árbol tiene que mostrarlas.
  const row = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  const modal = page.locator('.modal--carousel')
  await expect(modal).toBeVisible()
  await modal.getByRole('tab', { name: 'Stages & Tasks' }).click()
  await expect(modal.locator('.carousel__title')).toHaveText('Stages & Tasks')
  await expect(modal.getByText('Loading stages & tasks…')).toHaveCount(0, { timeout: 15000 })

  // El nodo "Tasks" agrupa los tasks del proyecto (no hay stage link). "Proyecto Prueba"
  // no tiene project_tasks (SOW) pero SÍ horas cargadas, así que este nodo prueba que el
  // árbol usa los tasks reales. (No se asertan nombres/horas exactos para no acoplar a la
  // seed; sólo que hay al menos un task real con sus horas.)
  const tasksNode = modal.locator('.stage-tree__node', {
    has: page.locator('.stage-tree__label', { hasText: /^No stage$/ }),
  })
  await expect(tasksNode).toBeVisible()

  // Expandir: cada task muestra nombre + id (task_number) + horas consumidas.
  await tasksNode.locator('.stage-tree__header').click()
  const taskRows = tasksNode.locator('.stage-tree__task')
  await expect(taskRows.first()).toBeVisible()
  expect(await taskRows.count()).toBeGreaterThan(0)
  // Nombre.
  await expect(tasksNode.locator('.stage-tree__task-name').first()).not.toHaveText('')
  // Id del task (task_number de Zoho, prefijado con #). El span solo aparece si la task
  // tiene task_number; "Proyecto Prueba" lo tiene, así que debe haber al menos uno.
  const idSpans = tasksNode.locator('.stage-tree__task-id')
  expect(await idSpans.count()).toBeGreaterThan(0)
  await expect(idSpans.first()).toContainText('#')
  // Horas consumidas: "Proyecto Prueba" tiene horas Approved bill_to_client, así que
  // ALGUNA task muestra consumido > 0 (verifica que la agregación de consumido corre, no
  // sólo que existe el texto "consumed"). Se busca en cualquier task, no la primera.
  await expect(
    tasksNode
      .locator('.stage-tree__task-meta')
      .filter({ hasText: /[1-9]\d*(\.\d+)? h consumed/ })
      .first(),
  ).toBeVisible()

  await page.keyboard.press('Escape')
})

/**
 * Read-only smoke: abrir el primer proyecto de la lista y confirmar que el slide llega a
 * un estado terminal (no queda "Loading…") — árbol, vacío o error.
 */
test('Projects & SOW: el slide "Stages & Tasks" llega a un estado terminal en cualquier proyecto', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const firstRow = page.locator('table.proj-table tbody tr').first()
  await firstRow.waitFor({ state: 'visible' })
  await firstRow.click()

  const modal = page.locator('.modal--carousel')
  await expect(modal).toBeVisible()
  await modal.getByRole('tab', { name: 'Stages & Tasks' }).click()
  await expect(modal.getByText('Loading stages & tasks…')).toHaveCount(0, { timeout: 15000 })

  const nodes = modal.locator('.stage-tree__node')
  const empty = modal.getByText('This project has no stages or tasks yet.')
  const errorMsg = modal.getByText('Stages & tasks could not be loaded', { exact: false })
  if ((await nodes.count()) === 0) {
    expect((await empty.count()) + (await errorMsg.count())).toBeGreaterThan(0)
  } else {
    // Con nodos: expandir el primero muestra su contenido (tasks o el vacío del nodo).
    const firstNode = nodes.first()
    const header = firstNode.locator('.stage-tree__header')
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(
      firstNode.locator('.stage-tree__task, .stage-tree__empty').first(),
    ).toBeVisible()
  }

  await page.keyboard.press('Escape')
})
