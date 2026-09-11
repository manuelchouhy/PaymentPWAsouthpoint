import { test, expect } from '@playwright/test'
import { loginAsTestAdmin, fieldOf, optionsOf } from './helpers'

/**
 * Dos regresiones de UI, ambas de solo lectura (no escriben nada en la base):
 *
 *  1. El handoff "detalle → editar" de Projects and SOW dejaba el body con
 *     `overflow: hidden` después de cerrar el modal de edición: el modal nuevo
 *     montaba mientras el carrusel todavía hacía su animación de salida, así
 *     que guardaba `prev = 'hidden'` y lo restauraba al cerrarse. La página
 *     quedaba sin scroll hasta recargar.
 *
 *  2. Los dropdowns de Entries se armaban cada uno sobre TODAS las entries, así
 *     que se podía combinar un proyecto con un contractor que nunca cargó horas
 *     ahí y la grilla daba "0 entries" sin pista de qué sobraba.
 */

test.describe('Projects and SOW · scroll de fondo', () => {
  test('cerrar el modal de edición devuelve el scroll de la página', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/projects')

    const firstRow = page.locator('table.proj-table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()

    // Carrusel de detalle abierto: el body tiene que estar bloqueado.
    const carousel = page.locator('.modal').first()
    await expect(carousel).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY))
      .toBe('hidden')

    // "Edit" cierra el carrusel y abre el form en el mismo click. Se ancla por
    // aria-labelledby: el carrusel también usa la clase .modal--form.
    const form = page.locator('[aria-labelledby="project-form-title"]')
    await carousel.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(form).toBeVisible()

    // Cancel (no Save): el test no escribe.
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)

    // Sin ningún overlay abierto, el scroll vuelve.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY))
      .not.toBe('hidden')
    // Y la página scrollea de verdad. El scrollport es el <body> (tiene
    // height:100% y overflow-x:hidden, que le computa overflow-y:auto), así que
    // se mira su scrollTop además del de la ventana.
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 600)
        return page.evaluate(() =>
          Math.max(window.scrollY, document.body.scrollTop, document.documentElement.scrollTop),
        )
      })
      .toBeGreaterThan(0)
  })
})

test.describe('Entries · listas de filtros entrelazadas', () => {
  test('elegir un proyecto recorta los contractors a los que cargaron horas ahí', async ({
    page,
  }) => {
    await loginAsTestAdmin(page)
    await page.goto('/entries')

    const field = (label: string) => fieldOf(page, label)

    // Se afirma que el fixture tiene datos en vez de skipear: un skip acá daría
    // verde justo cuando las aserciones de abajo no se corrieron.
    const allContractors = await optionsOf(page, 'Contractor')
    const projects = await optionsOf(page, 'Project')
    expect(projects.length, 'el fixture no tiene proyectos con horas').toBeGreaterThan(0)
    expect(allContractors.length, 'el fixture no tiene contractors con horas').toBeGreaterThan(0)

    // Se tilda el primer proyecto.
    await field('Project').locator('.msel__btn').click()
    await field('Project').locator('.msel__opt').first().click()
    await page.keyboard.press('Escape')

    const scopedContractors = await optionsOf(page, 'Contractor')
    expect(scopedContractors.length).toBeGreaterThan(0)
    expect(scopedContractors.length).toBeLessThanOrEqual(allContractors.length)
    for (const contractor of scopedContractors) {
      expect(allContractors).toContain(contractor)
    }

    // Ningún contractor ofrecido puede dar cero: eso era exactamente el bug.
    await field('Contractor').locator('.msel__btn').click()
    await field('Contractor').locator('.msel__opt').first().click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.toolbar__count')).not.toHaveText(/^0 entries/)

    // Y el ya tildado sigue listado aunque el cruce lo excluyera, para poder
    // destildarlo (si no, la pantalla quedaría trabada).
    const stillListed = await optionsOf(page, 'Contractor')
    const selected = await field('Contractor').locator('.msel__value').innerText()
    expect(stillListed).toContain(selected)
  })

  test('en Time Entries la tab Pending manda: un Billing Status imposible no ensancha las listas', async ({
    page,
  }) => {
    await loginAsTestAdmin(page)
    await page.goto('/time-entries')

    const field = (label: string) => fieldOf(page, label)
    await expect(field('Contractor')).toBeVisible()

    // Baseline explícito: la tab activa es "Pending to bill" y la lista de
    // contractors NO está vacía. Sin esto el test daría verde por el motivo
    // equivocado si el fixture no tuviera horas o si la tab de arranque
    // cambiara — justo cuando la regresión pasaría inadvertida.
    await expect(page.getByRole('tab', { name: /Pending to bill/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await field('Contractor').locator('.msel__btn').click()
    await expect(field('Contractor').locator('.msel__opt').first()).toBeVisible()
    await page.keyboard.press('Escape')

    // Tab "Pendiente de facturar" (la de arranque) + Billing Status = Invoiced:
    // la grilla no puede mostrar nada, así que las listas tienen que quedar en
    // lo tildado y nada más. Cruzar con billingStatuses vacío las devolvía al
    // total, que es el bug que este test cubre.
    await field('Billing Status').locator('.msel__btn').click()
    await field('Billing Status')
      .locator('.msel__opt', { hasText: 'Invoiced' })
      .first()
      .click()
    await page.keyboard.press('Escape')

    // La grilla no puede mostrar nada → el dropdown de Contractor queda vacío.
    expect(await optionsOf(page, 'Contractor')).toEqual([])
  })
})
