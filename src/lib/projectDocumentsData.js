/**
 * Subida de una nueva versión de documento desde el slide Documentos.
 *
 * Vive en su propio módulo y no dentro de projectsData.js porque necesita
 * tanto el bucket de proyectos como el de clientes, y clientsData.js ya
 * importa projectsData.js — meterlo ahí cerraría un ciclo de imports.
 *
 * Un documento tiene dos caras que hay que mantener juntas: el historial
 * (project_documents, una fila por versión, nunca se borra) y el puntero al
 * "actual" (clients.msa_url / projects.sow_url / project_stages.sow_url,
 * ver el comentario de la tabla en 0020). Escribir solo el historial deja al
 * resto de la app sirviendo el archivo viejo, así que las dos van juntas acá.
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { recordProjectDocumentStrict, removeSowFiles, uploadSowFile } from './projectsData'
import { uploadClientMsa } from './clientsData'

/**
 * Actualiza el puntero al documento vigente según a qué se subió. Los anexos
 * de Change Request no tienen columna "actual" — para ellos el historial es
 * la única fuente, así que no hay nada que actualizar.
 */
async function updateCurrentPointer({ subjectType, subjectId, project, fileUrl }) {
  if (!isSupabaseConfigured) return

  if (subjectType === 'msa') {
    const { error } = await supabase.from('clients').update({ msa_url: fileUrl }).eq('id', subjectId)
    if (error) throw new Error(error.message)
    return
  }
  if (subjectType === 'sow') {
    const table = project.hasStages ? 'project_stages' : 'projects'
    const { error } = await supabase.from(table).update({ sow_url: fileUrl }).eq('id', subjectId)
    if (error) throw new Error(error.message)
  }
}

/**
 * Sube un archivo como nueva versión de un documento del proyecto: lo manda
 * al bucket que corresponde, actualiza el puntero al vigente y lo registra
 * en el historial. Si algo falla después de subirlo, borra el archivo — si
 * no, queda en Storage sin ninguna fila que lo referencie (mismo criterio
 * que createProjectFromWizard).
 *
 * @param {{
 *   project: object,
 *   subjectType: 'msa'|'sow'|'change_request',
 *   subjectId: string|number,
 *   file: File,
 *   uploadedBy?: ?string,
 * }} params
 * @returns {Promise<{ fileUrl: string, document: ?Object }>} `document` es
 *   null en modo demo (no hay tabla donde registrar la versión).
 */
export async function uploadDocumentVersion({ project, subjectType, subjectId, file, uploadedBy }) {
  // El MSA vive en el bucket 'client-msa' (solo PDF) y el resto en
  // 'project-documents' (.docx o PDF) — cada uploader valida lo suyo.
  const fileUrl = subjectType === 'msa' ? await uploadClientMsa(file) : await uploadSowFile(file)

  try {
    await updateCurrentPointer({ subjectType, subjectId, project, fileUrl })
    const document = await recordProjectDocumentStrict({ subjectType, subjectId, fileUrl, uploadedBy })
    return { fileUrl, document }
  } catch (error) {
    // removeSowFiles solo sabe del bucket de proyectos; un MSA fallido queda
    // en 'client-msa' hasta que alguien lo limpie a mano (no hay un remove
    // equivalente en clientsData, y agregarlo excede este slice).
    if (subjectType !== 'msa') await removeSowFiles([fileUrl])
    throw error
  }
}
