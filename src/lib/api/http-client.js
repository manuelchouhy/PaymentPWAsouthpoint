/**
 * Implementación de ApiClient (ver ./types.ts) sobre un backend REST
 * tradicional (Node + MySQL, a cargo de Claudio). Todos los métodos son
 * stubs por ahora: documentan la URL, el body esperado y la response
 * esperada, y lanzan hasta que se completen contra los endpoints reales.
 *
 * Convención general:
 *   - Base URL: import.meta.env.VITE_API_BASE_URL (sin trailing slash).
 *   - Auth: cookie de sesión httpOnly (o Bearer token) inyectada por el
 *     backend; este cliente no la maneja explícitamente.
 *   - Body/response en camelCase (el backend traduce a snake_case en MySQL).
 */

function notImplemented(method) {
  throw new Error(
    `[http-client] ${method} not implemented yet — pending backend endpoint.`,
  )
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `HTTP ${response.status} on ${path}`)
  }
  return response.status === 204 ? null : response.json()
}

export const httpApiClient = {
  auth: {
    // GET /api/auth/session → { user } | null
    getSession: () => notImplemented('auth.getSession'),
    // No hay equivalente a Supabase Realtime auth events sobre REST simple;
    // el backend HTTP puede optar por polling o SSE. Placeholder no-op.
    onAuthStateChange: () => () => {},
    // GET /api/auth/microsoft/start → redirect al IdP
    signInWithMicrosoft: () => notImplemented('auth.signInWithMicrosoft'),
    // POST /api/auth/signout
    signOut: () => notImplemented('auth.signOut'),
    // POST /api/auth/provision → Profile
    provisionCurrentUser: () => notImplemented('auth.provisionCurrentUser'),
    // GET /api/app-config → AppConfig
    getAppConfig: () => notImplemented('auth.getAppConfig'),
    // PATCH /api/app-config { permissionsEnforced, sessionMaxHours } → AppConfig
    updateAppConfig: () => notImplemented('auth.updateAppConfig'),
    // GET /api/role-mappings → RoleMapping[]
    getRoleMappings: () => notImplemented('auth.getRoleMappings'),
    // PUT /api/role-mappings/:id | POST /api/role-mappings
    upsertRoleMapping: () => notImplemented('auth.upsertRoleMapping'),
    // GET /api/users → User[]
    listUsers: () => notImplemented('auth.listUsers'),
  },

  timeEntries: {
    // GET /api/time-entries?user_name=X&from=Y&to=Z → TimeEntry[]
    list: () => notImplemented('timeEntries.list'),
    // PATCH /api/time-entries/allocation { entryIds, allocation }
    //   → { updatedIds, skippedFrozen, failures, unconfirmed }
    // (las ya facturadas se descartan server-side; los tres contadores separan
    //  "nunca se va a poder", "reintentable" y "se perdió en silencio")
    setAllocation: () => notImplemented('timeEntries.setAllocation'),
  },

  invoices: {
    // GET /api/invoices → Invoice[]
    list: () => notImplemented('invoices.list'),
    // POST /api/invoices { supplierInvoiceNumber, invoiceDate, totalAmount,
    //   currency, notes, userName, entryIds, createdBy } → { invoice }
    create: () => notImplemented('invoices.create'),
    // PATCH /api/invoices/:id/status { fromStatus, toStatus, changedBy, note }
    //   → { invoice, historyEntry }
    updateStatus: () => notImplemented('invoices.updateStatus'),
    // GET /api/invoices/:id/history → InvoiceStatusHistoryEntry[]
    getStatusHistory: () => notImplemented('invoices.getStatusHistory'),
  },

  sync: {
    // POST /api/sync/trigger → { synced }
    trigger: () => notImplemented('sync.trigger'),
    // GET /api/sync/status → SyncStatus
    getStatus: () => notImplemented('sync.getStatus'),
    // GET /api/sync/log?limit=50 → SyncLogEntry[]
    getLog: () => notImplemented('sync.getLog'),
  },

  clients: {
    // GET /api/clients → Client[]
    list: () => notImplemented('clients.list'),
    // POST /api/clients { clientName, email, domain, primaryContactName,
    //   primaryContactEmail, msaUrl, createdBy } → Client
    create: () => notImplemented('clients.create'),
    // PATCH /api/clients/:id { ...updates } → Client
    update: () => notImplemented('clients.update'),
    // POST /api/clients/msa (multipart) → { path }
    uploadMsa: () => notImplemented('clients.uploadMsa'),
    // GET /api/clients/msa-url?path=X → string | null
    getMsaUrl: () => notImplemented('clients.getMsaUrl'),
    // POST /api/clients/:id/msa-version { fileUrl, uploadedBy } → void
    recordMsaVersion: () => notImplemented('clients.recordMsaVersion'),
  },

  assignments: {
    // GET /api/projects/:id/assignments → ProviderAssignment[]
    list: () => notImplemented('assignments.list'),
    // POST /api/assignments { projectId, taskName, providerName,
    //   authorizedHours, createdBy } → ProviderAssignment
    create: () => notImplemented('assignments.create'),
    // PATCH /api/assignments/:id/hours { authorizedHours, updatedBy } → ProviderAssignment
    updateHours: () => notImplemented('assignments.updateHours'),
    // GET /api/assignments/provider-names → string[]
    providerNames: () => notImplemented('assignments.providerNames'),
    // GET /api/assignments/task-names?project=X → string[]
    taskNames: () => notImplemented('assignments.taskNames'),
  },

  changeRequests: {
    // GET /api/projects/:id/change-requests → ChangeRequest[]
    list: () => notImplemented('changeRequests.list'),
    // POST /api/change-requests { projectId, type, deltaHours, reason } → ChangeRequest
    create: () => notImplemented('changeRequests.create'),
    // POST /api/change-requests/:id/approve → ChangeRequest
    approve: () => notImplemented('changeRequests.approve'),
    // POST /api/change-requests/:id/reject → ChangeRequest
    reject: () => notImplemented('changeRequests.reject'),
  },

  collections: {
    // GET /api/collections → Collection[]
    list: () => notImplemented('collections.list'),
    // POST /api/collections/register { invoiceId, amountReceived,
    //   collectionDate, bankReference, notes } → { collection, becameCollected }
    create: () => notImplemented('collections.create'),
    // GET /api/collections/alert-settings
    getAlertSettings: () => notImplemented('collections.getAlertSettings'),
    // PATCH /api/collections/alert-settings
    updateAlertSettings: () => notImplemented('collections.updateAlertSettings'),
  },

  payments: {
    // GET /api/payments → Payment[]
    list: () => notImplemented('payments.list'),
    // GET /api/payments/by-invoice/:invoiceId → Payment | null
    getByInvoice: () => notImplemented('payments.getByInvoice'),
    // POST /api/payments/register { invoiceId, amountPaid, paymentDate,
    //   bankMethod, transferReference, exchangeRate, notes } → { payment }
    create: () => notImplemented('payments.create'),
    // GET /api/payments/alert-settings
    getAlertSettings: () => notImplemented('payments.getAlertSettings'),
    // PATCH /api/payments/alert-settings
    updateAlertSettings: () => notImplemented('payments.updateAlertSettings'),
  },

  projects: {
    // GET /api/projects → Project[]
    list: () => notImplemented('projects.list'),
    // POST /api/projects → Project
    create: () => notImplemented('projects.create'),
    // POST /api/projects/from-wizard { ...payload } → { project, partialFailure }
    createFromWizard: () => notImplemented('projects.createFromWizard'),
    // PATCH /api/projects/:id → Project
    update: () => notImplemented('projects.update'),
    // GET /api/projects/:id/history
    getHistory: () => notImplemented('projects.getHistory'),
    // GET /api/projects/contract-alert-settings
    getContractAlertSettings: () => notImplemented('projects.getContractAlertSettings'),
    // PATCH /api/projects/contract-alert-settings
    updateContractAlertSettings: () => notImplemented('projects.updateContractAlertSettings'),
    // POST /api/projects/sow-file (multipart) → { path }
    uploadSowFile: () => notImplemented('projects.uploadSowFile'),
    // DELETE /api/projects/sow-files { paths } → void
    removeSowFiles: () => notImplemented('projects.removeSowFiles'),
    // GET /api/projects/document-url?path=X → string | null
    getDocumentUrl: () => notImplemented('projects.getDocumentUrl'),
    // GET /api/projects/:id/documents → ProjectDocument[]
    getDocuments: () => notImplemented('projects.getDocuments'),
    // POST /api/projects/documents { subjectType, subjectId, fileUrl, uploadedBy }
    recordDocument: () => notImplemented('projects.recordDocument'),
    // POST /api/projects/:id/documents (multipart) — sube, actualiza el
    // puntero al vigente y versiona → { fileUrl, document }
    uploadDocumentVersion: () => notImplemented('projects.uploadDocumentVersion'),
    // GET /api/projects/:id/stages → ProjectStage[]
    getStages: () => notImplemented('projects.getStages'),
    // POST /api/projects/:id/stages → ProjectStage[]
    createStages: () => notImplemented('projects.createStages'),
    // PATCH /api/projects/stages/:id → ProjectStage
    updateStage: () => notImplemented('projects.updateStage'),
  },

  projectTasks: {
    // GET /api/projects/:id/tasks → ProjectTask[]
    list: () => notImplemented('projectTasks.list'),
    // POST /api/projects/:id/tasks → ProjectTask[]
    create: () => notImplemented('projectTasks.create'),
    // PATCH /api/projects/tasks/:id → ProjectTask
    update: () => notImplemented('projectTasks.update'),
  },

  supplierContracts: {
    // GET /api/supplier-contracts?include_archived=false → SupplierContract[]
    list: () => notImplemented('supplierContracts.list'),
    // POST /api/supplier-contracts → SupplierContract
    create: () => notImplemented('supplierContracts.create'),
    // PATCH /api/supplier-contracts/:id → SupplierContract
    update: () => notImplemented('supplierContracts.update'),
    // GET /api/supplier-contracts/:id/history
    getHistory: () => notImplemented('supplierContracts.getHistory'),
    // POST /api/supplier-contracts/pdf (multipart/form-data) → { pdfUrl }
    uploadPdf: () => notImplemented('supplierContracts.uploadPdf'),
    // GET /api/supplier-contracts/pdf-url?path=... → { url }
    getPdfUrl: () => notImplemented('supplierContracts.getPdfUrl'),
    // POST /api/supplier-contracts/:id/renew → { archived, created }
    renew: () => notImplemented('supplierContracts.renew'),
    // POST /api/supplier-contracts/:id/mark-renewal { snoozeDays } → SupplierContract
    markRenewalInProgress: () => notImplemented('supplierContracts.markRenewalInProgress'),
    // POST /api/supplier-contracts/:id/alert-action { action }
    recordAlertAction: () => notImplemented('supplierContracts.recordAlertAction'),
    // GET /api/supplier-contracts/alert-settings
    getAlertSettings: () => notImplemented('supplierContracts.getAlertSettings'),
    // PATCH /api/supplier-contracts/alert-settings
    updateAlertSettings: () => notImplemented('supplierContracts.updateAlertSettings'),
    // GET /api/supplier-contracts/:id/alert-history
    getAlertHistory: () => notImplemented('supplierContracts.getAlertHistory'),
    // GET /api/supplier-contracts/:id/renewal-history
    getRenewalHistory: () => notImplemented('supplierContracts.getRenewalHistory'),
  },

  audit: {
    // POST /api/audit-log { actorEmail, actorRole, action, resourceType,
    //   resourceId, before, after }
    log: () => notImplemented('audit.log'),
    // GET /api/audit-log?action=&resourceType=&dateFrom=&dateTo= → AuditLogEntry[]
    list: () => notImplemented('audit.list'),
  },

  trace: {
    // GET /api/trace?contractor=&project=&dateFrom=&dateTo= → TraceRow[]
    search: () => notImplemented('trace.search'),
    // GET /api/trace/collections/:invoiceId → Collection[]
    getCollectionsForInvoice: () => notImplemented('trace.getCollectionsForInvoice'),
  },

  emailOutbox: {
    // GET /api/email-outbox → EmailOutboxEntry[]
    list: () => notImplemented('emailOutbox.list'),
    // POST /api/email-outbox/:id/retry
    retry: () => notImplemented('emailOutbox.retry'),
  },

  test: {
    // POST /api/test/login — solo con VITE_TEST_MODE=true en el backend de test.
    login: () => notImplemented('test.login'),
    // POST /api/test/cleanup-invoice-chain/:invoiceId
    cleanupInvoiceChain: () => notImplemented('test.cleanupInvoiceChain'),
  },
}
