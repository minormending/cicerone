import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePolyline } from '../src/geo/polyline.ts'
import { routesFrom } from '../src/import/wanderlog.ts'
import { withRoutes } from '../src/corridor/legs.ts'
import type { Leg, Place, Trip } from '../src/domain/types.ts'

test('the polyline decodes to Google’s own published example', () => {
  // The three points in Google's specification, which is the only fixture
  // for this that nobody can argue with.
  const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assert.deepEqual(points, [
    { lat: 38.5, lon: -120.2 },
    { lat: 40.7, lon: -120.95 },
    { lat: 43.252, lon: -126.453 },
  ])
})

test('decoded points carry five places and not seventeen', () => {
  // 5009300 / 1e5 is 50.093000000000004 in binary floating point, and a
  // thousand of those serialise to six times the JSON they should.
  for (const point of decodePolyline('_p~iF~ps|U_ulLnnqC')) {
    assert.ok(String(point.lat).length <= 10, String(point.lat))
    assert.ok(String(point.lon).length <= 11, String(point.lon))
  }
})

const doc = (table: Record<string, unknown>) => ({ tripPlan: {}, resources: { distancesBetweenPlaces: table } })
const entry = (polyline: string, metres: number, seconds: number) => ({
  route: {
    polyline,
    // The text is rendered for the account that owns the trip, which is why
    // only the value is read: this one says miles about a Prague walk.
    distance: { value: metres, text: '0.38 mi' },
    duration: { value: seconds, text: '7 mins' },
  },
})
const LINE = '_p~iF~ps|U_ulLnnqC'

test('routes are read from resources, which is not under tripPlan', () => {
  // `unwrap` descends into tripPlan, and resources is its sibling. Reading
  // through unwrap alone found nothing and reported a clean zero, which is
  // the quietest way for an importer to be broken.
  const routes = routesFrom(doc({ '["A","B","walking"]': entry(LINE, 612, 480) }))
  assert.deepEqual(Object.keys(routes), ['A>B'])
  assert.equal(routes['A>B']?.mode, 'walk')
  assert.equal(routes['A>B']?.metres, 612)
  assert.equal(routes['A>B']?.seconds, 480)
  assert.equal(routes['A>B']?.path.length, 2)
})

test('an entry with nothing to draw is skipped rather than half-read', () => {
  const routes = routesFrom(
    doc({
      '["A","B","transit"]': { route: null },
      '["C","D","walking"]': { route: { polyline: '', distance: { value: 1 }, duration: { value: 1 } } },
      '["E","F","teleport"]': entry(LINE, 10, 10),
      'not json': entry(LINE, 10, 10),
      '["G","H","walking"]': { route: { polyline: LINE, duration: { value: 60 } } },
      '["I","J","driving"]': entry(LINE, 900, 300),
    }),
  )
  // Only the last one survives: a route with no line, no mode we know, no
  // distance or no parseable key cannot be matched to a leg or drawn.
  assert.deepEqual(Object.keys(routes), ['I>J'])
  assert.equal(routes['I>J']?.mode, 'drive')
})

const place = (id: string, placeId: string): Place => ({
  id,
  name: id,
  placeId,
  coords: { lat: 50.08, lon: 14.42 },
  dayIndex: 1,
})

const leg = (from: string, to: string, mode: Leg['mode']): Leg => ({
  id: `leg:${from}:${to}`,
  fromPlaceId: from,
  toPlaceId: to,
  mode,
})

test('a route only reaches a leg that agrees about the mode', () => {
  // The tram between two stops and the walk between the same two stops are
  // different lines on the ground. Drawing one under a heading that says the
  // other is the one kind of wrong a reader cannot catch.
  const trip = {
    id: 't',
    title: 'x',
    places: [place('a', 'A'), place('b', 'B')],
    legs: [],
    routes: routesFrom(doc({ '["A","B","transit"]': entry(LINE, 2897, 1110) })),
  } as Trip

  assert.equal(withRoutes([leg('a', 'b', 'transit')], trip)[0]?.route?.metres, 2897)
  assert.equal(withRoutes([leg('a', 'b', 'walk')], trip)[0]?.route, undefined)
})

test('a trip the import knew no routes for is handed back untouched', () => {
  const trip = { id: 't', title: 'x', places: [place('a', 'A'), place('b', 'B')], legs: [] } as Trip
  const legs = [leg('a', 'b', 'walk')]
  assert.equal(withRoutes(legs, trip)[0]?.route, undefined)
})
