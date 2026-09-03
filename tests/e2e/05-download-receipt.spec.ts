import { test } from '@playwright/test'

// El recibo pasó a ser POR CONTRACTOR (modelo agrupado en horas). La descarga y el
// nombre del PDF (/^recibo-pago-.*\.pdf$/) ya los verifica el spec 04 end-to-end
// (pagar todos los contractors → click en Receipt → download). Este archivo queda como
// skip para no duplicar esa cobertura; el flujo single-contractor viejo con Collections
// ya no existe.
test.skip('descargar el recibo de pago (cubierto end-to-end por el spec 04)', () => {})
