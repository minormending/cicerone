import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionsLabel, directionsUrl } from '../src/render/directions.ts'
import type { Place } from '../src/domain/types.ts'

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
