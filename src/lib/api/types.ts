/**
 * Interfaz pública de la capa de datos (Prompt R1). Todo componente debe
 * hablar con el backend exclusivamente a través de un objeto que cumpla
 * este contrato — nunca importando `supabase` directamente.
 *
 * Dos implementaciones intercambiables:
 *   - supabase-client.js — la actual, delega en src/lib/*Data.js
 *   - http-client.js     — stub para el backend Node/MySQL de Claudio
 *
 * Este archivo es solo documentación de tipos (no se importa en runtime).
 */

export type Role = 'Administrator' | 'Operations' | 'Finance' | string

export interface Session {
  user: {
    id: string
    email: string
    user_metadata?: Record<string, unknown>
  }
}

export interface Profile {
  id: string
  email: string
  fullName: string
  upn?: string
  roles: Role[]
  isActive: boolean
  azureOid?: string
  lastLoginAt?: string
}

export interface AppConfig {
  permissionsEnforced: boolean
  sessionMaxHours: number
  adminBootstrapEmail: string | null
}

export interface RoleMapping {
  id: number
  azureGroupName: string
  roleName: string
  updatedAt?: string
  updatedBy?: string
}

export interface User {
  id: string
  email: string
  fullName: string
  roles: Role[]
  isActive: boolean
  lastLoginAt: string | null
  firstLoginAt?: string
}

export interface TimeEntry {
  id: string | number
  user: string
  project: string
  client: string
  task: string
  taskNumber: string
  description: string
  notes: string
  date: string // ISO YYYY-MM-DD
  hours: number
  status: 'Approved' | 'Rejected' | 'Pending' // approval_status de Zoho
  /**
   * null = sin clasificar (triage manual en Entries). 'unknown' es la categoría X
   * (allocation real del CHECK 0034): una hora que no encaja en las otras tres.
   */
  allocation?: 'bill_to_client' | 'overage' | 'sp_internal' | 'unknown' | null
}

export type BillingStatus = 'Pending' | 'Invoiced' | 'Collected' | 'Paid'

export interface Invoice {
  id: string | number
  supplierInvoiceNumber: string
  invoiceDate: string
  totalAmount: number
  currency: string
  notes: string | null
  userName: string
  entryIds: Array<string | number>
  status: 'Invoiced' | 'Collected' | 'Paid'
  paymentTermsDays: number
  createdAt: string
  createdBy: string | null
}

export interface InvoiceStatusHistoryEntry {
  id: string | number
  fromStatus: string | null
  toStatus: string
  changedAt: string
  changedBy: string | null
  note: string | null
}

export interface SyncStatus {
  lastSyncedAt: string | null
  lastStatus: string | null
  lastRecordsCount: number | null
  lastErrorMessage: string | null
}

export interface SyncLogEntry {
  id: string | number
  ranAt: string
  status: 'OK' | 'Error'
  recordsCount: number | null
  errorMessage: string | null
}

export interface Collection {
  id: string | number
  invoiceId: string | number
  amountReceived: number
  collectionDate: string
  bankReference: string
  notes: string
  createdAt: string
  createdBy: string | null
}

export interface Payment {
  id: string | number
  invoiceId: string | number
  amountPaid: number
  paymentDate: string
  bankMethod: string
  transferReference: string
  exchangeRate: number | null
  notes: string
  backDated: boolean
  createdAt: string
  createdBy: string | null
}

export interface Client {
  id: string | number
  clientName: string
  email?: string | null
  domain?: string | null
  primaryContactName: string
  primaryContactEmail: string
  msaUrl: string
  /** Alias del Project Group de Zoho que mapea a este cliente. */
  zohoGroupName?: string | null
  /** Auto-creado por el sync desde un grupo de Zoho, datos a completar. */
  needsReview?: boolean
  /** false = cliente desactivado (borrado lógico); getClients sólo trae activos. */
  active?: boolean
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export interface ProviderAssignment {
  id: string | number
  projectId: string | number
  taskName: string
  providerName: string
  authorizedHours: number
  consumedHours?: number
  remainingHours?: number
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export interface Project {
  id: string | number
  client: string
  clientId?: string | number | null
  baseBudgetHours?: number | null
  projectName: string
  projectNumber: string
  contractNumber?: string
  contractExpirationDate: string | null
  leadDeveloper?: string
  approver?: string
  hasStages?: boolean
  stageName?: string | null
  maintenanceEnabled?: boolean
  slaTemplate?: 'Standard' | 'Premium' | 'Custom' | null
  [key: string]: unknown
}

export interface ProjectStage {
  id: string | number
  projectId: string | number
  position: number
  stageName: string
  sowNumber: string
  sowUrl?: string | null
  createdAt: string
  createdBy: string | null
}

export interface ProjectTask {
  id: string | number
  projectId: string | number
  taskName: string
  role?: string | null
  estimatedHours: number
  createdAt: string
  createdBy: string | null
}

export interface ChangeRequest {
  id: string | number
  projectId: string | number
  crNumber: string
  type: 'expand_budget' | 'write_off_overage' | 'other'
  deltaHours: number
  reason: string | null
  requestedBy: string | null
  status: 'pending' | 'approved' | 'rejected'
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
  createdBy: string | null
}

export interface ProjectDocument {
  id: string | number
  subjectType: 'msa' | 'sow' | 'change_request'
  subjectId: string | number
  fileUrl: string
  version: number
  uploadedAt: string
  uploadedBy: string | null
}

export interface SupplierContract {
  id: string | number
  supplierName: string
  contractNumber: string
  startDate: string
  expirationDate: string
  renewalDate?: string
  renewalType: string
  paymentTerms: string
  isPrioritySupplier: boolean
  pdfUrl?: string | null
  archived?: boolean
  [key: string]: unknown
}

export interface AuditLogEntry {
  id: string | number
  timestamp: string
  actorEmail: string
  actorRole: string | null
  action: string
  resourceType: string | null
  resourceId: string | number | null
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export interface TraceRow {
  timeEntryId: string | number
  userName: string
  logDate: string
  hours: number
  project?: string
  client?: string
  invoiceId?: string | number
  invoiceStatus?: string
  paymentId?: string | number
  [key: string]: unknown
}

export interface EmailOutboxEntry {
  id: string | number
  category: string
  subject: string
  recipients: string[]
  createdAt: string
  sentAt: string | null
  failedAt: string | null
  retryCount: number
}

export interface ApiClient {
  auth: {
    getSession(): Promise<Session | null>
    onAuthStateChange(callback: (session: Session | null) => void): () => void
    signInWithMicrosoft(): Promise<{ error: Error | null }>
    signOut(): Promise<void>
    provisionCurrentUser(): Promise<Profile>
    getAppConfig(): Promise<AppConfig>
    updateAppConfig(
      settings: Partial<AppConfig>,
      updatedBy?: string | null,
    ): Promise<AppConfig>
    getRoleMappings(): Promise<RoleMapping[]>
    upsertRoleMapping(
      mapping: Partial<RoleMapping>,
      updatedBy?: string | null,
    ): Promise<void>
    listUsers(): Promise<User[]>
  }

  timeEntries: {
    list(): Promise<TimeEntry[]>
    /**
     * Triage en bloque: asigna la misma allocation a todas las entries dadas.
     * `updatedIds` son las que la base confirmó; puede ser un subconjunto de
     * `entryIds` por tres motivos que NO son equivalentes: `skippedFrozen` (ya
     * facturadas, definitivo), `failures` (tandas que fallaron, reintentable) y
     * `unconfirmed` (la base aceptó y no devolvió la fila: pérdida silenciosa).
     */
    setAllocation(
      // null vuelve la hora a "sin clasificar" (el "— sin clasificar" del
      // dropdown de Apply); el CHECK de la base admite null sin migración.
      entryIds: Array<string | number>,
      allocation: 'bill_to_client' | 'overage' | 'sp_internal' | null,
      changedBy?: string | null,
    ): Promise<{
      updatedIds: Array<string | number>
      skippedFrozen: number
      failures: string[]
      unconfirmed: number
    }>
  }

  invoices: {
    list(): Promise<Invoice[]>
    create(payload: Partial<Invoice>): Promise<{ ok: true; mode: string; invoice: Invoice }>
    updateStatus(payload: {
      invoiceId: string | number
      fromStatus: string
      toStatus: string
      changedBy?: string | null
      note?: string | null
    }): Promise<{ ok: true; mode: string; invoice: Invoice | null; historyEntry: InvoiceStatusHistoryEntry }>
    getStatusHistory(invoiceId: string | number): Promise<InvoiceStatusHistoryEntry[]>
  }

  sync: {
    trigger(): Promise<{ ok: true; mode: string; synced: number | null }>
    getStatus(): Promise<SyncStatus | null>
    getLog(limit?: number): Promise<SyncLogEntry[]>
  }

  collections: {
    list(): Promise<Collection[]>
    create(
      invoice: Invoice,
      payload: Partial<Collection>,
      alreadyCollected: number,
      createdBy?: string | null,
    ): Promise<{ collection: Collection; becameCollected: boolean }>
    getAlertSettings(): Promise<Record<string, unknown>>
    updateAlertSettings(settings: Record<string, unknown>, updatedBy?: string | null): Promise<Record<string, unknown>>
  }

  payments: {
    list(): Promise<Payment[]>
    getByInvoice(invoiceId: string | number): Promise<Payment | null>
    create(
      invoice: Invoice,
      payload: Partial<Payment>,
      createdBy?: string | null,
    ): Promise<{ payment: Payment }>
    getAlertSettings(): Promise<Record<string, unknown>>
    updateAlertSettings(settings: Record<string, unknown>, updatedBy?: string | null): Promise<Record<string, unknown>>
  }

  clients: {
    list(): Promise<Client[]>
    create(payload: Partial<Client>, createdBy?: string | null): Promise<Client>
    update(current: Client, updates: Partial<Client>): Promise<Client>
    /** Borrado lógico: pone active=false y libera el alias de Zoho. Lanza con
     *  code 'has_projects' si el cliente tiene proyectos activos que dependan de él
     *  (por client_id o por su alias de grupo). Necesita id y zohoGroupName. */
    deactivate(client: Pick<Client, 'id' | 'zohoGroupName'>): Promise<{ id: string | number }>
    uploadMsa(file: File): Promise<string>
    getMsaUrl(msaUrl: string): Promise<string | null>
    recordMsaVersion(params: {
      clientId: string | number
      fileUrl: string
      uploadedBy?: string | null
    }): Promise<void>
  }

  assignments: {
    list(project: { id: string | number; projectName: string }): Promise<ProviderAssignment[]>
    create(payload: Partial<ProviderAssignment>, createdBy?: string | null): Promise<ProviderAssignment>
    updateHours(
      id: string | number,
      authorizedHours: number,
      updatedBy?: string | null,
    ): Promise<ProviderAssignment>
    /** Nombres asignables (distintos user_name de time_entries) para el dropdown. */
    providerNames(): Promise<string[]>
    /** Tasks asignables: los distintos `task` de time_entries del proyecto. */
    taskNames(projectName: string): Promise<string[]>
  }

  changeRequests: {
    list(projectId: string | number): Promise<ChangeRequest[]>
    create(
      payload: {
        projectId: string | number
        type: 'expand_budget' | 'write_off_overage' | 'other'
        deltaHours: number
        reason?: string | null
      },
      createdBy?: string | null,
    ): Promise<ChangeRequest>
    approve(id: string | number, decidedBy?: string | null): Promise<ChangeRequest>
    reject(id: string | number, decidedBy?: string | null): Promise<ChangeRequest>
  }

  projects: {
    list(): Promise<Project[]>
    create(payload: Partial<Project>, createdBy?: string | null): Promise<Project>
    createFromWizard(
      payload: Partial<Project> & {
        sowFile?: File | null
        stages?: Array<{ stageName: string; sowNumber: string; sowFile: File }>
        tasks?: Array<{ taskName: string; role?: string | null; estimatedHours: number }>
      },
      createdBy?: string | null,
    ): Promise<{ project: Project; partialFailure: Error | null }>
    update(current: Project, updates: Partial<Project>, changedBy?: string | null): Promise<Project>
    getHistory(projectId: string | number): Promise<unknown[]>
    getContractAlertSettings(): Promise<Record<string, unknown>>
    updateContractAlertSettings(settings: Record<string, unknown>, updatedBy?: string | null): Promise<Record<string, unknown>>
    uploadSowFile(file: File): Promise<string>
    removeSowFiles(paths: string[]): Promise<void>
    getDocumentUrl(path: string): Promise<string | null>
    getDocuments(project: {
      id: string | number
      client?: string
      clientId?: string | number | null
      hasStages: boolean
    }): Promise<{
      documents: Array<ProjectDocument & { linkedToLabel: string }>
      stages: Array<{ id: string | number; stageName: string }>
      changeRequests: Array<{ id: string | number; crNumber: string }>
    }>
    recordDocument(params: {
      subjectType: 'msa' | 'sow' | 'change_request'
      subjectId: string | number
      fileUrl: string
      uploadedBy?: string | null
    }): Promise<void>
    /**
     * Sube una nueva versión: la manda al bucket que corresponde, actualiza el
     * puntero al documento vigente y la registra en el historial. `document`
     * es null en modo demo. Propaga el error (y limpia el archivo subido).
     */
    uploadDocumentVersion(params: {
      project: Project
      subjectType: 'msa' | 'sow' | 'change_request'
      subjectId: string | number
      file: File
      uploadedBy?: string | null
    }): Promise<{ fileUrl: string; document: ProjectDocument | null }>
    getStages(projectId: string | number): Promise<ProjectStage[]>
    createStages(
      projectId: string | number,
      stages: Array<{ stageName: string; sowNumber: string; sowUrl?: string | null }>,
      createdBy?: string | null,
      startPosition?: number,
    ): Promise<ProjectStage[]>
    updateStage(
      current: { id: string | number; projectId: string | number },
      updates: { stageName?: string; sowNumber?: string; sowUrl?: string | null },
    ): Promise<ProjectStage>
  }

  projectTasks: {
    list(projectId: string | number): Promise<ProjectTask[]>
    create(
      projectId: string | number,
      tasks: Array<{ taskName: string; role?: string | null; estimatedHours: number }>,
      createdBy?: string | null,
    ): Promise<ProjectTask[]>
    update(
      current: { id: string | number; projectId: string | number },
      updates: { taskName?: string; role?: string | null; estimatedHours?: number },
    ): Promise<ProjectTask>
  }

  supplierContracts: {
    list(opts?: { includeArchived?: boolean }): Promise<SupplierContract[]>
    create(payload: Partial<SupplierContract>, createdBy?: string | null): Promise<SupplierContract>
    update(
      current: SupplierContract,
      updates: Partial<SupplierContract>,
      changedBy?: string | null,
    ): Promise<SupplierContract>
    getHistory(contractId: string | number): Promise<unknown[]>
    uploadPdf(file: File): Promise<string>
    getPdfUrl(pdfUrl: string): Promise<string | null>
    renew(
      oldContract: SupplierContract,
      payload: Partial<SupplierContract>,
      by?: string | null,
    ): Promise<{ archived: SupplierContract; created: SupplierContract }>
    markRenewalInProgress(
      contract: SupplierContract,
      snoozeDays: number,
      by?: string | null,
    ): Promise<SupplierContract>
    recordAlertAction(contractId: string | number, action: string, by?: string | null): Promise<void>
    getAlertSettings(): Promise<Record<string, unknown>>
    updateAlertSettings(settings: Record<string, unknown>, updatedBy?: string | null): Promise<Record<string, unknown>>
    getAlertHistory(contractId: string | number): Promise<unknown[]>
    getRenewalHistory(contract: SupplierContract): Promise<unknown[]>
  }

  audit: {
    log(entry: Partial<AuditLogEntry>): Promise<void>
    list(filters?: {
      action?: string
      resourceType?: string
      dateFrom?: string
      dateTo?: string
    }): Promise<AuditLogEntry[]>
  }

  trace: {
    search(filters?: {
      search?: string
      contractor?: string
      project?: string
      dateFrom?: string
      dateTo?: string
    }): Promise<TraceRow[]>
    getCollectionsForInvoice(invoiceId: string | number): Promise<Collection[]>
  }

  emailOutbox: {
    list(): Promise<EmailOutboxEntry[]>
    retry(id: string | number): Promise<void>
  }

  /** Solo activo con VITE_TEST_MODE=true — infraestructura para Playwright (Prompt R2). */
  test: {
    login(): Promise<void>
    cleanupInvoiceChain(invoiceId: string | number): Promise<void>
  }
}
