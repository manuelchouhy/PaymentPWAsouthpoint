import { test } from '@playwright/test'

// En el modelo agrupado el número único de la factura es el SP invoice number, no el
// supplier# (que ahora es por-contractor y se carga al pagar). La unicidad la ENFORCEA la
// base: la RPC create_grouped_invoice hace un EXISTS y hay un índice único parcial sobre
// sp_invoice_number (migración 0039); data.js mapea el 23505 a "That SP invoice number
// already exists." El builder unit-testeado (invoiceContractors.test.js) NO cubre este
// camino (es guard de DB, no del builder), así que hoy la unicidad del SP number NO tiene
// cobertura automatizada: reescribir el e2e (emitir dos veces el mismo SP number sobre
// semanas distintas) es un TODO pendiente. Saltado, con esa brecha reconocida.
test.skip('emitir con un SP invoice number ya usado se bloquea (guard de DB; e2e pendiente)', () => {})
