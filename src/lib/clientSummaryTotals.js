/**
 * Agregación pura de totales de Client Summary (sin React ni red), para poder
 * testearse aislado con `node --test`. Hay dos vistas distintas a propósito:
 *
 *  - La TABLA (fila-cabecera de cliente y fila Total) suma sobre las SEMANAS
 *    VISIBLES, así cuadra con las celdas Consumed/Overage mostradas aunque el
 *    filtro Week haya recortado filas.
 *  - Los GRÁFICOS son una foto de estado de budget: usan las horas ALL-TIME de
 *    cada proyecto (project.consumed/overage) y no dependen del filtro Week.
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
        t.pending += w.pending
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
    t.pending += g.pending
    if (g.hasBudget) t.hasBudget = true
  }
  return t
}

/**
 * Totales para los gráficos: horas ALL-TIME por proyecto. `remaining` se acumula
 * POR PROYECTO (max(0, budget − consumido all-time)) para no netear el consumo de
 * un proyecto contra el budget de otro.
 */
export function chartTotals(clients) {
  const t = { budget: 0, consumed: 0, overage: 0, pending: 0, remaining: 0, hasBudget: false }
  for (const group of clients) {
    for (const p of group.projects) {
      t.consumed += p.consumed
      t.overage += p.overage
      t.pending += p.pending || 0
      if (p.budget != null) {
        t.budget += p.budget
        t.hasBudget = true
        t.remaining += Math.max(0, p.budget - p.consumed)
      }
    }
  }
  return t
}
