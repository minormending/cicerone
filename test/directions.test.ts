import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayDirectionsUrl, directionsLabel, directionsUrl } from '../src/render/directions.ts'
import type { Corridor, Place, TransportMode } from '../src/domain/types.ts'

const place = (id: string, name: string, extra: Partial<Place> = {}): Place => ({
  id,
  name,
  coords: { lat: 50.0909, lon: 14.4005 },
  dayIndex: 1,
  ...extra,
})

const VITUS = place('vitus', 'St. Vitus Cathedral', { placeId: 'ChIJ_vitus' })
const STERN = place('stern', 'Šternberský Palace', {
  placeId: 'ChIJ_stern',
  coords: { lat: 50.0901, lon: 14.3987 },
})

test('a walk is Google’s documented directions URL, keyed by place id', () => {
  const url = new URL(directionsUrl(VITUS, STERN, 'walk') ?? '')
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/')
  // api=1 is what makes this the supported, keyless scheme rather than a
  // scraped path that Google is free to change.
  assert.equal(url.searchParams.get('api'), '1')
  assert.equal(url.searchParams.get('origin_place_id'), 'ChIJ_vitus')
  assert.equal(url.searchParams.get('destination_place_id'), 'ChIJ_stern')
  assert.equal(url.searchParams.get('travelmode'), 'walking')
  // Google requires the human-readable half alongside the id, and drops the
  // id without it.
  assert.equal(url.searchParams.get('origin'), 'St. Vitus Cathedral')
  assert.equal(url.searchParams.get('destination'), 'Šternberský Palace')
})

test('without a place id an end is coordinates, never a name to search for', () => {
  // A bare name is a text search run from another country. There is a Lokál
  // on four streets in Prague and more elsewhere; coordinates cannot be
  // misread the way a name can.
  const anon = place('x', 'Lokál', { coords: { lat: 50.0875, lon: 14.4211 } })
  const url = new URL(directionsUrl(VITUS, anon, 'walk') ?? '')
  assert.equal(url.searchParams.get('destination'), '50.087500,14.421100')
  assert.equal(url.searchParams.get('destination_place_id'), null)
  assert.equal(url.searchParams.get('origin_place_id'), 'ChIJ_vitus')
})

test('a flight gets no link at all', () => {
  // Google answers "JFK to Prague" with a route that is not the flight, and
  // under a passage about the flight a reader has no way to tell.
  assert.equal(directionsUrl(VITUS, STERN, 'flight'), undefined)
  assert.equal(directionsLabel(VITUS, STERN, 'flight'), undefined)
})

test('every rail-shaped mode asks Google for transit', () => {
  for (const mode of ['transit', 'bus', 'metro', 'rail', 'ferry'] as const) {
    const url = new URL(directionsUrl(VITUS, STERN, mode) ?? '')
    assert.equal(url.searchParams.get('travelmode'), 'transit', mode)
  }
  assert.equal(new URL(directionsUrl(VITUS, STERN, 'taxi') ?? '').searchParams.get('travelmode'), 'driving')
  assert.equal(new URL(directionsUrl(VITUS, STERN, 'cycle') ?? '').searchParams.get('travelmode'), 'bicycling')
})

test('the label says the mode the link actually asks for', () => {
  // Phrased from Google's mode, so a metro ride can never be announced as
  // driving to somebody who only hears the label.
  assert.match(directionsLabel(VITUS, STERN, 'metro') ?? '', /^Transit directions from St\. Vitus/)
  assert.match(directionsLabel(VITUS, STERN, 'walk') ?? '', /^Walking directions/)
  assert.match(directionsLabel(VITUS, STERN, 'walk') ?? '', /in Google Maps$/)
})

// ---- the whole day as one route ----

const stop = (id: string, n: number): Place => ({
  id,
  name: id,
  placeId: `ChIJ_${id}`,
  coords: { lat: 50.08 + n / 1000, lon: 14.42 + n / 1000 },
  dayIndex: 1,
})

const joins = (from: string, to: string, mode: TransportMode = 'walk'): Corridor => ({
  id: `corridor:${from}:${to}`,
  legId: `leg:${from}:${to}`,
  fromPlaceId: from,
  toPlaceId: to,
  mode,
  dayIndex: 1,
  view: 'open',
})

const chain = (n: number, mode: TransportMode = 'walk') => {
  const stops = Array.from({ length: n }, (_, i) => stop(`s${i}`, i))
  const corridors = stops.slice(1).map((s, i) => joins(`s${i}`, s.id, mode))
  return { stops, corridors }
}

test('a day walked end to end is one route, with the middle as waypoints', () => {
  const { stops, corridors } = chain(6)
  const day = dayDirectionsUrl(stops, corridors)
  const url = new URL(day?.url ?? '')
  assert.equal(url.searchParams.get('origin_place_id'), 'ChIJ_s0')
  assert.equal(url.searchParams.get('destination_place_id'), 'ChIJ_s5')
  assert.equal(url.searchParams.get('waypoint_place_ids'), 'ChIJ_s1|ChIJ_s2|ChIJ_s3|ChIJ_s4')
  assert.equal(url.searchParams.get('waypoints'), 's1|s2|s3|s4')
  assert.equal(url.searchParams.get('travelmode'), 'walking')
  assert.equal(day?.label, "The day's walk")
  assert.match(day?.description ?? '', /through all 6 stops/)
})

test('a day over Google’s cap gets nothing rather than a route missing five stops', () => {
  // Eleven points is the documented limit: an origin, nine waypoints, a
  // destination. Truncating to fit would look right and be wrong, which is
  // the worst of the two ways to be wrong.
  const fits = chain(11)
  const over = chain(12)
  assert.ok(dayDirectionsUrl(fits.stops, fits.corridors))
  assert.equal(dayDirectionsUrl(over.stops, over.corridors), undefined)
})

test('a day with a transit leg gets nothing, because Google cannot route it', () => {
  // Verified against Google, not assumed: asked for a three-stop transit
  // route it answers "we could not calculate transit directions" and shows
  // an empty panel.
  const { stops, corridors } = chain(4)
  corridors[1]!.mode = 'metro'
  assert.equal(dayDirectionsUrl(stops, corridors), undefined)
  // Even all-transit, because the failure is waypoints, not the mix.
  const allTransit = chain(4, 'transit')
  assert.equal(dayDirectionsUrl(allTransit.stops, allTransit.corridors), undefined)
})

test('a day of mixed walkable modes gets nothing: a URL carries one', () => {
  // A day that cycles to the park and walks the rest would be drawn entirely
  // on foot, or entirely on a bicycle. Neither is the day.
  const { stops, corridors } = chain(4)
  corridors[0]!.mode = 'cycle'
  assert.equal(dayDirectionsUrl(stops, corridors), undefined)
})

test('a gap with no corridor across it breaks the day', () => {
  // The link would claim a continuous walk across a jump the itinerary never
  // made. Matched by id, so a day with the right *number* of corridors that
  // do not join its stops up still fails.
  const { stops, corridors } = chain(5)
  corridors[2] = joins('s0', 's4')
  assert.equal(dayDirectionsUrl(stops, corridors), undefined)
})

test('two stops are left to the corridor that already links them', () => {
  const { stops, corridors } = chain(2)
  assert.equal(dayDirectionsUrl(stops, corridors), undefined)
  assert.ok(directionsUrl(stops[0]!, stops[1]!, 'walk'))
})

test('one stop without a place id costs the whole day its ids, not its link', () => {
  // The two lists are matched by position, so a partial list would hand a
  // waypoint somebody else's identity. Coordinates for all of them instead.
  const { stops, corridors } = chain(4)
  delete stops[2]!.placeId
  const url = new URL(dayDirectionsUrl(stops, corridors)?.url ?? '')
  assert.equal(url.searchParams.get('waypoint_place_ids'), null)
  assert.equal(url.searchParams.get('waypoints'), 's1|50.082000,14.422000')
  assert.equal(url.searchParams.get('origin_place_id'), 'ChIJ_s0')
})
