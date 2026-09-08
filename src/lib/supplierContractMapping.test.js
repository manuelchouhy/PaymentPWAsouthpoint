import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowToContract, contractToRow } from './supplierContractMapping.js'

test('rowToContract expone el role de la fila', () => {
  const contract = rowToContract({ id: 1, supplier_name: 'Ada', role: 'Developer' })
  assert.equal(contract.role, 'Developer')
})

test('rowToContract deja role en null cuando la fila no lo trae', () => {
  const contract = rowToContract({ id: 1, supplier_name: 'Ada' })
  assert.equal(contract.role, null)
})

test('contractToRow manda role a la columna role', () => {
  const row = contractToRow({ role: 'QA' })
  assert.equal(row.role, 'QA')
})

test('contractToRow normaliza role vacío a null', () => {
  const row = contractToRow({ role: '' })
  assert.equal(row.role, null)
})

test('contractToRow omite role cuando no se toca (undefined)', () => {
  const row = contractToRow({ supplierName: 'Ada' })
  assert.ok(!('role' in row))
})

test('contractToRow preserva un 0 numérico (no lo colapsa a null)', () => {
  const row = contractToRow({ weeklyContractedHours: 0 })
  assert.equal(row.weekly_contracted_hours, 0)
})
