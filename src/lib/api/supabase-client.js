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
  getContractAlertSettings,
  getProjectHistory,
  getProjects,
  updateContractAlertSettings,
  updateProject,
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
    provisionCurrentUser,
    getAppConfig,
    updateAppConfig,
    getRoleMappings,
    upsertRoleMapping,
    listUsers,
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

  projects: {
    list: getProjects,
    create: createProject,
    update: updateProject,
    getHistory: getProjectHistory,
    getContractAlertSettings,
    updateContractAlertSettings,
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
