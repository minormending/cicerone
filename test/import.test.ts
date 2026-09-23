import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tripFromWanderlog, travelModeFrom } from '../src/import/wanderlog.ts'
import { withLegs } from '../src/corridor/legs.ts'
import { corridorsOf } from '../src/corridor/waking.ts'

const DOC = JSON.parse(readFileSync('test/fixtures/wanderlog-prague.json', 'utf8'))

test('the real document maps to the trip it describes', () => {
  // The fixture is the document the API actually returns, not a trimmed one.
  // A trimmed fixture is what hid `travelMode` from an earlier reading of it,
  // and an invented one is what let the previous app ship a mapper that
  // returned nothing while its tests passed.
  const { trip, report } = tripFromWanderlog(DOC, {})
  assert.equal(report.places - report.unscheduled, 33)
  assert.equal(trip.title, 'Trip to Prague')
  assert.equal(trip.departsOn, '2026-10-14')
  assert.ok(trip.places.some((p) => p.name.includes('Vitus')))
})

test('the stated travel mode is read where the traveller set one', () => {
  const { trip } = tripFromWanderlog(DOC, {})
  const stated = trip.places.filter((p) => p.arriveBy)
  assert.equal(stated.length, 2, 'two of ninety-nine blocks carry a mode')
  assert.ok(stated.every((p) => p.arriveBy === 'transit'))
})

test('wanderlog mode names map onto ours', () => {
  assert.equal(travelModeFrom({ travelMode: 'walking' }), 'walk')
  assert.equal(travelModeFrom({ travelMode: 'DRIVING' }), 'drive')
  assert.equal(travelModeFrom({ travelMode: 'transit' }), 'transit')
  assert.equal(travelModeFrom({ travelMode: null }), undefined)
  assert.equal(travelModeFrom({}), undefined)
  assert.equal(travelModeFrom({ travelMode: 'teleport' }), undefined)
})

test('the corridors of the real trip', () => {
  const { trip } = tripFromWanderlog(DOC, {})
  const withL = withLegs(trip)
  const corridors = corridorsOf(withL)
  assert.equal(withL.legs.length, 32)
  assert.equal(corridors.length, 28, 'four dropped: one overnight flight and three nights')
})
