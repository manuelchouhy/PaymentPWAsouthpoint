import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

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

    // Se ancla en el <span> del label con match exacto: `hasText` sobre el .msel
    // entero mira también el valor elegido y, con el panel abierto, las opciones
    // — un proyecto llamado "Contractor…" bindearía el dropdown equivocado.
    const field = (label: string) =>
      page
        .locator('.msel')
        .filter({ has: page.locator('.filterfield__label', { hasText: new RegExp(`^${label}$`) }) })
        .first()
    const optionsOf = async (label: string) => {
      await field(label).locator('.msel__btn').click()
      const values = await field(label).locator('.msel__opt-label').allInnerTexts()
      await page.keyboard.press('Escape')
      return values
    }

    // Se afirma que el fixture tiene datos en vez de skipear: un skip acá daría
    // verde justo cuando las aserciones de abajo no se corrieron.
    const allContractors = await optionsOf('Contractor')
    const projects = await optionsOf('Project')
    expect(projects.length, 'el fixture no tiene proyectos con horas').toBeGreaterThan(0)
    expect(allContractors.length, 'el fixture no tiene contractors con horas').toBeGreaterThan(0)

    // Se tilda el primer proyecto.
    await field('Project').locator('.msel__btn').click()
    await field('Project').locator('.msel__opt').first().click()
    await page.keyboard.press('Escape')

    const scopedContractors = await optionsOf('Contractor')
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
    const stillListed = await optionsOf('Contractor')
    const selected = await field('Contractor').locator('.msel__value').innerText()
    expect(stillListed).toContain(selected)
  })
})
