import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitApprovalReadiness } from './allocations.js'

test('separa aprobadas (facturables) de no aprobadas (fuera de Billing)', () => {
  const r = splitApprovalReadiness([
    { status: 'Approved', hours: 3 },
    { status: 'Approved', hours: 1.5 },
    { status: 'Pending', hours: 2 },
    { status: 'Pending', hours: 4 },
  ])
  assert.deepEqual(r, {
    approvedCount: 2,
    approvedHours: 4.5,
    notApprovedCount: 2,
    notApprovedHours: 6,
  })
})

test('Rejected también cuenta como no aprobada (no entra a Billing)', () => {
  const r = splitApprovalReadiness([{ status: 'Rejected', hours: 5 }])
  assert.equal(r.approvedCount, 0)
  assert.equal(r.notApprovedCount, 1)
  assert.equal(r.notApprovedHours, 5)
})

test('todas aprobadas → notApproved en cero', () => {
  const r = splitApprovalReadiness([{ status: 'Approved', hours: 2 }])
  assert.deepEqual(r, { approvedCount: 1, approvedHours: 2, notApprovedCount: 0, notApprovedHours: 0 })
})

test('tolera lista vacía, null y horas inválidas', () => {
  assert.deepEqual(splitApprovalReadiness(), { approvedCount: 0, approvedHours: 0, notApprovedCount: 0, notApprovedHours: 0 })
  const r = splitApprovalReadiness([{ status: 'Approved', hours: 'x' }, { status: 'Pending' }])
  assert.equal(r.approvedCount, 1) // Approved sigue contando aunque sus horas sean inválidas
  assert.equal(r.approvedHours, 0)
  assert.equal(r.notApprovedCount, 1)
  assert.equal(r.notApprovedHours, 0)
})
