// Métodos de pago para el campo `bank_method` del pago al contractor. `bank_method`
// se persiste como text libre en DB (sin enum/CHECK), así que sumar un método es
// sólo agregarlo acá. 'Other' queda último como catch-all.
//
// Vive en su propio módulo puro (sin imports de browser/Supabase) para poder
// unit-testearlo con node --test; paymentsData.js lo re-exporta para los consumidores.
export const BANK_METHODS = ['BBVA', 'Itaú', 'Santander', 'Prex', 'Other']
