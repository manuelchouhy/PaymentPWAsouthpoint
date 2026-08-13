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
  getInvoices,
  getInvoiceStatusHistory,
  getSyncLog,
  getSyncStatus,
  getTimeEntries,
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
  getClientMsaUrl,
  getClients,
  recordClientMsaVersion,
  updateClient,
  uploadClientMsa,
} from '../clientsData'

import {
  createAssignment,
  getAssignments,
  updateAssignmentHours,
} from '../assignmentsData'

import {
  createCollection,
  getCollectionAlertSettings,
  getCollections,
  updateCollectionAlertSettings,
} from '../collectionsData'

import {
  createPayment,
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
  await supabase.from('payments').delete().eq('invoice_id', invoiceId)
  await supabase.from('collections').delete().eq('invoice_id', invoiceId)
  await supabase.from('invoice_status_history').delete().eq('invoice_id', invoiceId)
  await supabase.from('invoices').delete().eq('id', invoiceId)
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
  },

  timeEntries: {
    list: getTimeEntries,
  },

  invoices: {
    list: getInvoices,
    create: createInvoice,
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
    getAlertSettings: getPaymentAlertSettings,
    updateAlertSettings: updatePaymentAlertSettings,
  },

  clients: {
    list: getClients,
    create: createClientRecord,
    update: updateClient,
    uploadMsa: uploadClientMsa,
    getMsaUrl: getClientMsaUrl,
    recordMsaVersion: recordClientMsaVersion,
  },

  assignments: {
    list: getAssignments,
    create: createAssignment,
    updateHours: updateAssignmentHours,
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
    recordDocument: recordProjectDocument,
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
