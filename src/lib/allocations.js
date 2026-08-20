// Mapa único de allocation → etiqueta + clase de badge, compartido por Entries y
// Billing (drawer de detalle). Antes vivía duplicado en ambas páginas y podía
// divergir en silencio al cambiar una categoría.
//
// 'unknown' es la categoría X (allocation real, CHECK 0034): una hora que no
// encaja en las otras tres. Distinta de null (= sin clasificar / sin triagear).
export const ALLOCATION_LABELS = {
  bill_to_client: { label: 'bill to client', cls: 'badge--alloc-bill' },
  overage: { label: 'overage', cls: 'badge--alloc-overage' },
  sp_internal: { label: 'SP internal', cls: 'badge--alloc-internal' },
  unknown: { label: 'X', cls: 'badge--alloc-unknown' },
}
