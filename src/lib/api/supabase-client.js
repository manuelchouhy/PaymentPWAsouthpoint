/**
 * Implementación de ApiClient (ver ./types.ts) sobre Supabase. Es un facade
 * delgado: toda la lógica de negocio sigue viviendo en src/lib/*Data.js, este
 * módulo solo la agrupa bajo la forma del contrato ApiClient y absorbe las
 * pocas llamadas a `supabase.auth.*` que antes vivían en los componentes
 * (AuthGate, LoginScreen).
 */
import { supabase, isSupabaseConfigured } from '../supabase'

import {
  createInvoice,
  createGroupedInvoice,
  getInvoices,
  getInvoiceContractors,
  getInvoiceStatusHistory,
  getSyncLog,
  getSyncStatus,
  getTimeEntries,
  setEntriesAllocation,
  triggerSync,
  updateInvoiceStatus,
} from '../data'

import {
  getAppConfig,
  getRoleMappings,
  listUsers,
  provisionCurrentUser,
  updateAppConfig,
  upsertRoleMapping,
} from '../authData'

import {
  createClient as createClientRecord,
  deactivateClient,
  getClientMsaUrl,
  getClients,
  recordClientMsaVersion,
  removeClientMsa,
  updateClient,
  uploadClientMsa,
} from '../clientsData'

import {
  createAssignment,
  getAssignments,
  getProjectTaskNames,
  getProviderNames,
  updateAssignmentHours,
} from '../assignmentsData'

import {
  approveChangeRequest,
  createChangeRequest,
  getChangeRequests,
  getChangeRequestsByProject,
  rejectChangeRequest,
} from '../changeRequestsData'

import { uploadDocumentVersion } from '../projectDocumentsData'

import {
  createCollection,
  getCollectionAlertSettings,
  getCollections,
  updateCollectionAlertSettings,
} from '../collectionsData'

import {
  createPayment,
  createOveragePayment,
  getPaymentAlertSettings,
  getPaymentByInvoice,
  getPayments,
  updatePaymentAlertSettings,
} from '../paymentsData'

import {
  createProject,
  createProjectFromWizard,
  createProjectStages,
  createProjectTasks,
  getContractAlertSettings,
  getProjectDocuments,
  getProjectDocumentUrl,
  getProjectHistory,
  getProjects,
  getProjectStages,
  getProjectTasks,
  recordProjectDocument,
  removeSowFiles,
  updateContractAlertSettings,
  updateProject,
  updateProjectStage,
  updateProjectTask,
  uploadSowFile,
} from '../projectsData'

import {
  createSupplierContract,
  getContractPdfUrl,
  getRenewalHistory,
  getSupplierAlertHistory,
  getSupplierAlertSettings,
  getSupplierContractHistory,
  getSupplierContracts,
  markRenewalInProgress,
  recordAlertAction,
  renewSupplierContract,
  updateSupplierAlertSettings,
  updateSupplierContract,
  uploadContractPdf,
} from '../supplierContractsData'

import { getAuditLog, logAudit } from '../auditData'
import { getCollectionsForInvoice, searchTrace } from '../traceData'
import { getEmailOutbox, retryEmail } from '../emailOutboxData'

const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@southpoint.local',
  user_metadata: { name: 'Demo' },
}

// --- Test mode (Prompt R2) --------------------------------------------------
// VITE_TEST_MODE=true expone /test-login: Playwright entra ahí en vez de por
// el SSO real de Microsoft. testLogin() hace un signInWithPassword real
// contra Supabase Auth (con un usuario dedicado pw-test-admin@southpoint.local)
// — necesario porque las RLS policies exigen rol "authenticated"; una sesión
// puramente mockeada en el cliente no alcanza para pasar los inserts reales
// de invoices/collections/payments. El perfil (rol Administrator) sí se
// mockea, para no depender de la tabla users (que mapea por azure_oid).
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true'
const TEST_ADMIN_EMAIL = import.meta.env.VITE_TEST_ADMIN_EMAIL
const TEST_ADMIN_PASSWORD = import.meta.env.VITE_TEST_ADMIN_PASSWORD

const TEST_PROFILE = {
  id: 'pw-test-admin',
  email: 'pw-test-admin@southpoint.local',
  fullName: 'PW Test Admin',
  roles: ['Administrator'],
  isActive: true,
}

function requireTestMode(method) {
  if (!TEST_MODE) {
    throw new Error(`[api.test] ${method} is only available when VITE_TEST_MODE=true`)
  }
}

async function testLogin() {
  requireTestMode('login')
  if (!TEST_ADMIN_EMAIL || !TEST_ADMIN_PASSWORD) {
    throw new Error(
      '[api.test] login requires VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD.',
    )
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD,
  })
  if (error) throw error
}

async function testCleanupInvoiceChain(invoiceId) {
  requireTestMode('cleanupInvoiceChain')
  if (!isSupabaseConfigured || !invoiceId) return
  // Orden dictado por las FKs a invoices:
  //  - invoice_contractors.payment_id → payments(id) es NON-cascade. Aunque
  //    invoice_contractors.invoice_id SÍ cascadea, ese cascade recién corre al borrar la
  //    factura (último paso), demasiado tarde: hay que borrar las filas hijas ACÁ, antes
  //    que los pagos, o el delete de payments viola esa FK. Por eso el delete explícito.
  //  - payments.invoice_id es NON-cascade → hay que borrar los pagos explícitamente.
  //  - collections / invoice_status_history son ON DELETE CASCADE desde invoices, así que
  //    el delete de la factura los limpia (el cascade ignora la RLS de esas hijas). NO se
  //    borran acá aparte: sus policies de delete de test siguen keyeadas en supplier#
  //    (0015), que en el modelo agrupado es NULL → un delete explícito sería no-op y daría
  //    falsa cobertura. El cascade es la vía real para esas dos.
  // Se loguea el error de cada delete: si una policy de test no alcanza (p. ej. 0043 sin
  // aplicar en ese entorno), el delete devuelve error sin tirar y dejaría residuo en la DB
  // real — sin este log, ese leak (justo el que 0043 previene) pasaría inadvertido.
  const del = async (table, col, val) => {
    const { error } = await supabase.from(table).delete().eq(col, val)
    if (error) console.error(`[api.test] cleanupInvoiceChain: delete ${table} falló:`, error)
  }
  await del('invoice_contractors', 'invoice_id', invoiceId)
  await del('payments', 'invoice_id', invoiceId)
  await del('invoices', 'id', invoiceId)
}

// Borra facturas de prueba y sus dependencias. Id-free: el flujo agrupado no expone el
// id al test, así que el cleanup se hace por número. Con `spNumber` scopea a ESA factura
// (SP o supplier# exacto) — así un test no pisa la factura de otro en vuelo. Sin él,
// barre todas las PW-TEST-% (red de seguridad). Usado en el finally de los specs e2e.
async function testCleanupTestInvoices() {
  requireTestMode('cleanupTestInvoices')
  if (!isSupabaseConfigured) return
  // Barre TODAS las PW-TEST-% (LIKE con literal fijo, sin interpolar nada del caller).
  // Sweep global a propósito: así reclama también residuo de una corrida anterior que
  // falló antes de limpiar. Es seguro porque Playwright corre con workers:1 /
  // fullyParallel:false (los tests comparten esta misma DB — ver playwright.config.ts):
  // no hay otra corrida en vuelo cuyas facturas se puedan pisar. Si algún día se habilita
  // paralelismo, esto debe pasar a limpieza por id de factura de la corrida.
  const { data, error } = await supabase
    .from('invoices')
    .select('id')
    .or('sp_invoice_number.like.PW-TEST-%,supplier_invoice_number.like.PW-TEST-%')
  if (error) {
    // Cleanup best-effort, pero un fallo silencioso dejaría residuo en la DB real:
    // se avisa para que no pase inadvertido en el output del test.
    console.error('[api.test] cleanupTestInvoices: no se pudieron listar facturas de test:', error)
    return
  }
  for (const row of data ?? []) await testCleanupInvoiceChain(row.id)
}

async function getSession() {
  if (!isSupabaseConfigured) return { user: DEMO_USER }
  const { data } = await supabase.auth.getSession()
  return data.session
}

function onAuthStateChange(callback) {
  if (!isSupabaseConfigured) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
    callback(nextSession)
  })
  return () => data?.subscription?.unsubscribe()
}

async function signOut() {
  if (!isSupabaseConfigured) return
  await supabase.auth.signOut()
}

async function provisionCurrentUserOrTest() {
  if (TEST_MODE) return TEST_PROFILE
  return provisionCurrentUser()
}

async function getAppConfigOrTest() {
  if (TEST_MODE) {
    return { permissionsEnforced: false, sessionMaxHours: 8, adminBootstrapEmail: null }
  }
  return getAppConfig()
}

async function signInWithMicrosoft() {
  if (!isSupabaseConfigured) {
    const error = new Error(
      'Supabase is not configured in this environment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
    error.code = 'not_configured'
    return { error }
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid email profile',
      redirectTo: window.location.origin,
    },
  })
  return { error: error ?? null }
}

export const supabaseApiClient = {
  auth: {
    getSession,
    onAuthStateChange,
    signInWithMicrosoft,
    signOut,
    provisionCurrentUser: provisionCurrentUserOrTest,
    getAppConfig: getAppConfigOrTest,
    updateAppConfig,
    getRoleMappings,
    upsertRoleMapping,
    listUsers,
  },

  test: {
    login: testLogin,
    cleanupInvoiceChain: testCleanupInvoiceChain,
    cleanupTestInvoices: testCleanupTestInvoices,
  },

  timeEntries: {
    list: getTimeEntries,
    setAllocation: setEntriesAllocation,
  },

  invoices: {
    list: getInvoices,
    listContractors: getInvoiceContractors,
    create: createInvoice,
    createGrouped: createGroupedInvoice,
    updateStatus: updateInvoiceStatus,
    getStatusHistory: getInvoiceStatusHistory,
  },

  sync: {
    trigger: triggerSync,
    getStatus: getSyncStatus,
    getLog: getSyncLog,
  },

  collections: {
    list: getCollections,
    create: createCollection,
    getAlertSettings: getCollectionAlertSettings,
    updateAlertSettings: updateCollectionAlertSettings,
  },

  payments: {
    list: getPayments,
    getByInvoice: getPaymentByInvoice,
    create: createPayment,
    createOverage: createOveragePayment,
    getAlertSettings: getPaymentAlertSettings,
    updateAlertSettings: updatePaymentAlertSettings,
  },

  clients: {
    list: getClients,
    create: createClientRecord,
    update: updateClient,
    deactivate: deactivateClient,
    uploadMsa: uploadClientMsa,
    removeMsa: removeClientMsa,
    getMsaUrl: getClientMsaUrl,
    recordMsaVersion: recordClientMsaVersion,
  },

  assignments: {
    list: getAssignments,
    create: createAssignment,
    updateHours: updateAssignmentHours,
    providerNames: getProviderNames,
    taskNames: getProjectTaskNames,
  },

  changeRequests: {
    list: getChangeRequests,
    listByProject: getChangeRequestsByProject,
    create: createChangeRequest,
    approve: approveChangeRequest,
    reject: rejectChangeRequest,
  },

  projects: {
    list: getProjects,
    create: createProject,
    createFromWizard: createProjectFromWizard,
    update: updateProject,
    getHistory: getProjectHistory,
    getContractAlertSettings,
    updateContractAlertSettings,
    uploadSowFile,
    removeSowFiles,
    getDocumentUrl: getProjectDocumentUrl,
    getDocuments: getProjectDocuments,
    recordDocument: recordProjectDocument,
    uploadDocumentVersion,
    getStages: getProjectStages,
    createStages: createProjectStages,
    updateStage: updateProjectStage,
  },

  projectTasks: {
    list: getProjectTasks,
    create: createProjectTasks,
    update: updateProjectTask,
  },

  supplierContracts: {
    list: getSupplierContracts,
    create: createSupplierContract,
    update: updateSupplierContract,
    getHistory: getSupplierContractHistory,
    uploadPdf: uploadContractPdf,
    getPdfUrl: getContractPdfUrl,
    renew: renewSupplierContract,
    markRenewalInProgress,
    recordAlertAction,
    getAlertSettings: getSupplierAlertSettings,
    updateAlertSettings: updateSupplierAlertSettings,
    getAlertHistory: getSupplierAlertHistory,
    getRenewalHistory,
  },

  audit: {
    log: logAudit,
    list: getAuditLog,
  },

  trace: {
    search: searchTrace,
    getCollectionsForInvoice,
  },

  emailOutbox: {
    list: getEmailOutbox,
    retry: retryEmail,
  },
}
