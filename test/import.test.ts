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

test('the note the traveller wrote against a stop reaches the trip', () => {
  /*
   * Why this is worth its own test.
   *
   * `noteText` read these from the first commit and `brief()` serialised them
   * from the first commit, and nothing in between ever assigned one to a
   * place — so every note anybody had written was parsed, carried halfway and
   * dropped, silently, on every import. Nothing failed. The field was simply
   * always undefined, and an empty field looks exactly like a document with
   * nothing in it.
   *
   * It is also the most valuable field in the document. Everything else says
   * what a place is; only this says why it was chosen, and no amount of
   * research reconstructs it.
   */
  const { trip } = tripFromWanderlog(DOC, {})
  const scheduled = trip.places.filter((p) => p.dayIndex !== undefined)
  const noted = scheduled.filter((p) => p.note)
  assert.ok(noted.length > 15, `expected most stops to carry a note, got ${noted.length}`)

  const banhMi = scheduled.find((p) => p.name === 'Mr. Banh Mi')
  assert.equal(banhMi?.note, 'Grilled pork banh mi, 6 min from the hotel; fast, which suits an arrival day.')

  // The same place also sits in an undated "Food" bucket with an empty note.
  // The dated block is the one carrying both the time and the reason, so a
  // stop must never come back with the bucket's blank in place of it.
  assert.ok(banhMi?.arrive, 'and it is the dated block that won')
})

test('a stop with nothing written against it stays silent', () => {
  // Absence is meaningful here: it means the traveller did not say why, not
  // that the importer lost it. Inventing a note would be the worst possible
  // failure of a field whose whole value is that it is theirs.
  const { trip } = tripFromWanderlog(DOC, {})
  const hotel = trip.places.find((p) => p.name === 'Hotel Royal Plaza')
  assert.equal(hotel?.note, undefined)
})

test('the flights come through, with the times the airline states', () => {
  /*
   * These were invisible for the life of the importer, and not because of a
   * parsing bug: the first share key this trip was imported with carried
   * `showReservations: false`, so Wanderlog withheld the whole section and
   * there was nothing in the document to find. A second key with reservations
   * turned on produces it.
   */
  const { trip } = tripFromWanderlog(DOC, {})
  assert.equal(trip.flights?.length, 2)
  const [out, home] = trip.flights ?? []
  assert.deepEqual(out?.depart, {
    iata: 'JFK',
    name: 'New York John F. Kennedy International Airport',
    date: '2026-10-14',
    time: '18:45',
    city: 'New York',
  })
  assert.equal(out?.number, 'DL78')
  assert.equal(out?.arrive.iata, 'PRG')
  assert.equal(out?.arrive.time, '09:00')
  // Flown order, not typed order.
  assert.equal(home?.number, 'DL79')
  assert.equal(home?.depart.date, '2026-10-18')
})

test('a flight carries no confirmation number', () => {
  /*
   * The one field in the document worth stealing. It earns a guide nothing
   * the times do not, and a rendered book is a file people send to each other,
   * so it is not read at all rather than read and then withheld.
   */
  const { trip } = tripFromWanderlog(DOC, {})
  const serialised = JSON.stringify(trip.flights)
  assert.doesNotMatch(serialised, /confirmation/i)
  assert.doesNotMatch(serialised, /travelerNames/i)
})

test('a trip whose share link hides reservations simply has no flights', () => {
  // Absence has to be clean: no empty array to be mistaken for "none booked".
  const withoutFlights = JSON.parse(JSON.stringify(DOC))
  withoutFlights.tripPlan.itinerary.sections = withoutFlights.tripPlan.itinerary.sections.filter(
    (s: { type?: string }) => s.type !== 'flights',
  )
  const { trip } = tripFromWanderlog(withoutFlights, {})
  assert.equal(trip.flights, undefined)
})
