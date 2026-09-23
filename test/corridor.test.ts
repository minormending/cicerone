import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferLegs, inferMode, metresBetween, minutesOfDay } from '../src/corridor/legs.ts'
import { awakeFor, corridorsOf, DEFAULT_WAKING, LONG_GAP_MINUTES, viewFrom } from '../src/corridor/waking.ts'
import type { Leg, Place, Trip } from '../src/domain/types.ts'

const place = (id: string, name: string, lat: number, lon: number, extra: Partial<Place> = {}): Place => ({
  id,
  name,
  coords: { lat, lon },
  dayIndex: 1,
  ...extra,
})

const leg = (extra: Partial<Leg> = {}): Leg => ({
  id: 'l1',
  fromPlaceId: 'a',
  toPlaceId: 'b',
  mode: 'transit',
  ...extra,
})

test('two stops on the same square are a walk', () => {
  // St. Vitus to Schwarzenberg Palace, the real coordinates: 300 m apart.
  const m = metresBetween({ lat: 50.0908918, lon: 14.4005114 }, { lat: 50.0892369, lon: 14.3967817 })
  assert.ok(m > 100 && m < 500, `expected a few hundred metres, got ${m}`)
  assert.equal(inferMode(m), 'walk')
})

test('an ocean between two stops is a flight', () => {
  // JFK to Václav Havel.
  const m = metresBetween({ lat: 40.6446124, lon: -73.7797278 }, { lat: 50.101791, lon: 14.2631811 })
  assert.equal(inferMode(m), 'flight')
})

test('the clock overrules the distance where both are known', () => {
  // 400 km in eight hours is a train, not a plane, whatever the map says.
  assert.equal(inferMode(400_000, 8 * 60), 'rail')
  assert.equal(inferMode(400_000, 70), 'flight')
})

test('times parse, and nonsense does not', () => {
  assert.equal(minutesOfDay('09:40'), 580)
  assert.equal(minutesOfDay('00:00'), 0)
  assert.equal(minutesOfDay('24:01'), undefined)
  assert.equal(minutesOfDay('9.40'), undefined)
  assert.equal(minutesOfDay(undefined), undefined)
})

test('a red-eye is not a corridor', () => {
  // Lands at 07:10, so any overlap test would call this awake. The traveller
  // was unconscious for seven of the eight hours.
  assert.equal(awakeFor(leg({ departAt: '23:10', arriveAt: '07:10' })), false)
})

test('an early start is a corridor', () => {
  assert.equal(awakeFor(leg({ departAt: '06:40', arriveAt: '08:05' })), true)
})

test('a leg with no clock at all counts as awake', () => {
  // Most stops on a real itinerary carry no time. Silence about the whole trip
  // is a worse failure than a passage nobody reads.
  assert.equal(awakeFor(leg()), true)
})

test('one end is enough to judge by', () => {
  assert.equal(awakeFor(leg({ departAt: '02:30' })), false)
  assert.equal(awakeFor(leg({ arriveAt: '14:00' })), true)
})

test('a short gap means awake, whatever the hour the window says', () => {
  // The itinerary is the better witness. Four minutes between two stops at
  // two in the morning is somebody out late, not somebody asleep, and a fixed
  // window called it sleep.
  assert.equal(awakeFor(leg({ departAt: '02:00', arriveAt: '02:04' })), true)
  assert.equal(awakeFor(leg({ departAt: '01:30', arriveAt: '02:30' })), true)
  assert.equal(LONG_GAP_MINUTES, 180)
})

test('the waking window decides once the gap is long enough to sleep through', () => {
  assert.equal(awakeFor(leg({ departAt: '04:00', arriveAt: '09:00' })), false)
  assert.equal(awakeFor(leg({ departAt: '04:00', arriveAt: '09:00' }), { from: 3 * 60, to: 22 * 60 }), true)
  assert.equal(DEFAULT_WAKING.from, 420)
})

test('what can be seen out of the window decides the passage kind', () => {
  assert.equal(viewFrom('walk'), 'open')
  assert.equal(viewFrom('rail'), 'open')
  assert.equal(viewFrom('ferry'), 'open')
  assert.equal(viewFrom('flight'), 'enclosed')
  assert.equal(viewFrom('metro'), 'enclosed')
})

test('a walk has no minimum duration', () => {
  // A twelve-minute walk is the densest corridor there is, and a floor would
  // throw away the best material on a city itinerary.
  const trip: Trip = {
    id: 't',
    title: 'T',
    places: [place('a', 'A', 50.0875, 14.4212), place('b', 'B', 50.087, 14.4207)],
    legs: [leg({ fromPlaceId: 'a', toPlaceId: 'b', mode: 'walk', departAt: '12:00', arriveAt: '12:04' })],
  }
  assert.equal(corridorsOf(trip).length, 1)
})

test('dinner to tomorrow morning is a night, not a walk', () => {
  // The real Prague trip produced exactly this: 21:45 to 08:15 across a day
  // boundary, two kilometres apart, which an earlier rule kept as a stroll
  // because walks were exempt from the clock.
  const trip: Trip = {
    id: 't',
    title: 'T',
    places: [place('a', 'Dinner', 50.0754, 14.4383), place('b', 'Market', 50.0707, 14.4141, { dayIndex: 2 })],
    legs: [leg({ fromPlaceId: 'a', toPlaceId: 'b', mode: 'walk', departAt: '21:45', arriveAt: '08:15' })],
  }
  assert.deepEqual(corridorsOf(trip), [])
})

test('a day-boundary leg missing a departure is not believed', () => {
  // Days are joined so an overnight flight has somewhere to live, but most of
  // what that join produces is a night in a hotel wearing a journey's clothes.
  const trip: Trip = {
    id: 't',
    title: 'T',
    places: [place('a', 'A', 50.0875, 14.4212), place('b', 'B', 50.0749, 14.4377, { dayIndex: 2 })],
    legs: [leg({ fromPlaceId: 'a', toPlaceId: 'b', mode: 'walk', arriveAt: '07:45' })],
  }
  assert.deepEqual(corridorsOf(trip), [])
})

test('an overnight flight yields no corridor', () => {
  const trip: Trip = {
    id: 't',
    title: 'T',
    places: [place('a', 'JFK', 40.6446, -73.7797), place('b', 'PRG', 50.1018, 14.2632, { dayIndex: 2 })],
    legs: [leg({ fromPlaceId: 'a', toPlaceId: 'b', mode: 'flight', departAt: '22:40', arriveAt: '12:10' })],
  }
  assert.deepEqual(corridorsOf(trip), [])
})

test('a daytime flight is a corridor, and it is enclosed', () => {
  const trip: Trip = {
    id: 't',
    title: 'T',
    places: [place('a', 'A', 40.6446, -73.7797), place('b', 'B', 50.1018, 14.2632)],
    legs: [leg({ fromPlaceId: 'a', toPlaceId: 'b', mode: 'flight', departAt: '09:00', arriveAt: '15:30' })],
  }
  const [corridor] = corridorsOf(trip)
  assert.equal(corridor?.view, 'enclosed')
  assert.equal(corridor?.mode, 'flight')
})

test('the same hotel on two days is a night, not a journey', () => {
  const legs = inferLegs([
    place('h1', 'Hotel Royal Plaza', 50.0781218, 14.4319911, { dayIndex: 2 }),
    place('h2', 'Hotel Royal Plaza', 50.0781218, 14.4319911, { dayIndex: 3 }),
    place('x', 'Somewhere else', 50.0908918, 14.4005114, { dayIndex: 3 }),
  ])
  assert.equal(legs.length, 1)
  assert.equal(legs[0]?.fromPlaceId, 'h2')
})

test('legs join the end of one day to the start of the next', () => {
  const legs = inferLegs([
    place('a', 'A', 50.08, 14.42, { dayIndex: 1 }),
    place('b', 'B', 50.09, 14.40, { dayIndex: 2 }),
  ])
  assert.equal(legs.length, 1, 'the day boundary is where an overnight flight lives')
})

test('a place on no day is not part of the journey', () => {
  // Wanderlog standing lists — restaurants somebody might go to — carry no
  // day and are not stops.
  const legs = inferLegs([
    place('a', 'A', 50.08, 14.42, { dayIndex: 1 }),
    { id: 'idea', name: 'A place we might go', coords: { lat: 50.07, lon: 14.43 } },
    place('b', 'B', 50.09, 14.4, { dayIndex: 2 }),
  ])
  assert.equal(legs.length, 1)
  assert.equal(legs[0]?.toPlaceId, 'b')
})

test('a mode the traveller stated beats any distance heuristic', () => {
  // Wanderlog carries travelMode on every block and leaves it null on 97 of
  // the 99 in a real trip. Rare, and worth honouring exactly when it happens:
  // they know they are getting a tram.
  const legs = inferLegs([
    place('a', 'A', 50.0875, 14.4212),
    place('b', 'B', 50.0870, 14.4207, { arriveBy: 'transit' }),
  ])
  assert.equal(legs[0]?.mode, 'transit', 'four hundred metres, and still not a walk')
})

test('with nothing stated the distance decides', () => {
  const legs = inferLegs([place('a', 'A', 50.0875, 14.4212), place('b', 'B', 50.087, 14.4207)])
  assert.equal(legs[0]?.mode, 'walk')
})
