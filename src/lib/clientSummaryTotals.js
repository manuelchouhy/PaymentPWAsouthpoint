/**
 * Agregación pura de totales de Client Summary (sin React ni red), para poder
 * testearse aislado con `node --test`. Hay dos vistas distintas a propósito:
 *
 *  - La TABLA (fila-cabecera de cliente y fila Total) suma sobre las SEMANAS
 *    VISIBLES, así cuadra con las celdas Consumed/Overage mostradas aunque el
 *    filtro Week haya recortado filas.
 *  - Los GRÁFICOS suman consumed/overage/pending/invoiced sobre las SEMANAS
 *    VISIBLES (igual que la tabla), así respetan el filtro Week; el `budget` y el
 *    `remaining` quedan a nivel proyecto (el budget no es semanal). Sin filtro Week
 *    (todas las semanas visibles) el total coincide con el all-time del proyecto.
 *
 * En ambos, `budget` suma solo proyectos con presupuesto cargado (hasBudget lo
 * marca) para no tratar un null como 0.
 */

/** Totales por cliente para la tabla, sumando las semanas visibles de cada proyecto. */
export function tableTotalsByClient(clients) {
  const map = new Map()
  for (const group of clients) {
    const t = { budget: 0, consumed: 0, overage: 0, pending: 0, hasBudget: false }
    for (const p of group.projects) {
      if (p.budget != null) {
        t.budget += p.budget
        t.hasBudget = true
      }
      for (const w of p.weeks) {
        t.consumed += w.consumed
        t.overage += w.overage
        t.pending += w.pending || 0
      }
    }
    map.set(group.client, t)
  }
  return map
}

/** Total de portfolio a partir del mapa por-cliente. */
export function portfolioTotals(byClient) {
  const t = { budget: 0, consumed: 0, overage: 0, pending: 0, hasBudget: false }
  for (const g of byClient.values()) {
    t.budget += g.budget
    t.consumed += g.consumed
    t.overage += g.overage
    t.pending += g.pending || 0
    if (g.hasBudget) t.hasBudget = true
  }
  return t
}

/**
 * Totales de UN proyecto para su fila COLAPSADA (una fila por proyecto en vez de
 * una por semana). Suma sobre las semanas VISIBLES que se le pasen (coherente con
 * tableTotalsByClient bajo el filtro Week):
 *  - consumed / pending / overage → suma de las semanas.
 *  - cumulative / remaining → el valor FINAL (última semana visible), porque son
 *    acumulados: sumarlos no tendría sentido.
 *  - budget → el fijo del proyecto; remaining cae al budget si no hay semanas.
 */
export function projectRowTotals(project) {
  const weeks = project.weeks ?? []
  const t = {
    budget: project.budget ?? null,
    hasBudget: project.budget != null,
    consumed: 0,
    pending: 0,
    overage: 0,
    cumulative: 0,
    remaining: project.budget ?? null,
  }
  for (const w of weeks) {
    t.consumed += w.consumed || 0
    t.pending += w.pending || 0
    t.overage += w.overage || 0
  }
  if (weeks.length) {
    const last = weeks[weeks.length - 1]
    t.cumulative = last.cumulative
    t.remaining = last.remaining
  }
  return t
}

/**
 * Totales para los gráficos: suma consumed/overage/pending/invoiced sobre las SEMANAS
 * VISIBLES de cada proyecto (respeta el filtro Week, igual que la tabla). `budget` es el
 * fijo del proyecto y `remaining` se acumula POR PROYECTO (max(0, budget − consumido de las
 * semanas visibles)) para no netear el consumo de un proyecto contra el budget de otro.
 * Sin filtro Week (todas las semanas presentes) el total coincide con el all-time del proyecto.
 */
export function chartTotals(clients) {
  const t = { budget: 0, consumed: 0, overage: 0, pending: 0, invoiced: 0, remaining: 0, hasBudget: false }
  for (const group of clients) {
    for (const p of group.projects) {
      let pConsumed = 0
      for (const w of p.weeks ?? []) {
        pConsumed += w.consumed || 0
        t.consumed += w.consumed || 0
        t.overage += w.overage || 0
        t.pending += w.pending || 0
        t.invoiced += w.invoiced || 0
      }
      if (p.budget != null) {
        t.budget += p.budget
        t.hasBudget = true
        t.remaining += Math.max(0, p.budget - pConsumed)
      }
    }
  }
  return t
}
