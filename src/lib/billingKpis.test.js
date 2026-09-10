import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billingKpis } from './billingKpis.js'

// Helper: entry mínimo con los campos que mira billingKpis.
const e = (id, hours, { status = 'Approved', allocation = 'bill_to_client' } = {}) => ({
  id,
  hours,
  status,
  allocation,
})

test('pendingToBill: suma horas Approved bill_to_client NO facturadas', () => {
  const billToClient = [e('1', 5), e('2', 3)]
  const r = billingKpis({ billToClient, allAllocations: billToClient, invoicedIds: new Set() })
  assert.equal(r.pendingToBill, 8)
  assert.equal(r.pendingCount, 2)
})

test('pendingToBill excluye facturadas y no-aprobadas', () => {
  const billToClient = [
    e('1', 5), // pendiente
    e('2', 3), // facturada
    e('3', 4, { status: 'Rejected' }), // rechazada
  ]
  const r = billingKpis({
    billToClient,
    allAllocations: billToClient,
    invoicedIds: new Set(['2']),
  })
  assert.equal(r.pendingToBill, 5) // solo la 1
  assert.equal(r.pendingCount, 1)
})

test('invoiced: suma cualquier hora facturada, incl. allocation null (pre-triage)', () => {
  const all = [
    e('1', 5, { allocation: null }), // pre-triage facturada
    e('2', 3, { allocation: 'bill_to_client' }), // facturada
    e('3', 4, { allocation: 'bill_to_client' }), // NO facturada
  ]
  const r = billingKpis({ billToClient: [], allAllocations: all, invoicedIds: new Set(['1', '2']) })
  assert.equal(r.invoiced, 8)
})

test('unallocated: Approved con allocation falsy y SIN facturar', () => {
  const all = [
    e('1', 5, { allocation: null }), // sin clasificar
    e('2', 2, { allocation: '' }), // sin clasificar (vacío)
    e('3', 4, { allocation: null }), // sin clasificar pero facturada → excluida
    e('4', 9, { allocation: null, status: 'Rejected' }), // rechazada → excluida
  ]
  const r = billingKpis({ billToClient: [], allAllocations: all, invoicedIds: new Set(['3']) })
  assert.equal(r.unallocated, 7) // 5 + 2
})

test('overage: suma Approved con allocation overage, sin facturar', () => {
  const all = [
    e('1', 6, { allocation: 'overage' }),
    e('2', 2, { allocation: 'overage', status: 'Pending' }), // no aprobada → excluida
    e('3', 3, { allocation: 'sp_internal' }), // otra allocation → excluida
    e('4', 5, { allocation: 'overage' }), // facturada → excluida (mismo criterio que unallocated)
  ]
  const r = billingKpis({ billToClient: [], allAllocations: all, invoicedIds: new Set(['4']) })
  assert.equal(r.overage, 6)
})

test('listas vacías → todo en cero', () => {
  const r = billingKpis({})
  assert.deepEqual(r, {
    pendingToBill: 0,
    pendingCount: 0,
    invoiced: 0,
    unallocated: 0,
    overage: 0,
  })
})
