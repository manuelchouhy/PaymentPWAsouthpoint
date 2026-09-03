import { test } from '@playwright/test'

// Collections quedó DECOMISIONADO en el modelo agrupado en horas (slice 04d/0041):
// Billing va directo a Payments (sin cobro intermedio) y la migración 0041 dropeó la
// vista invoice_collection_totals. La página /collections quedó money-broken (muestra
// $0.00, no crashea) y su retiro es un open item. Este spec queda saltado hasta que se
// decida retirar o rehacer la ruta.
test.skip('registrar cobro total mueve la factura a Collected (Collections decomisionado)', () => {})
