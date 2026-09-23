import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choose, NAMED_METRES, search, verifiedAt, vouchedFor, type Candidate } from '../src/photos/unsplash.ts'
import { cityFrom, illustrate, queryFor } from '../src/photos/illustrate.ts'
import type { Place, Trip } from '../src/domain/types.ts'

const GREBOVKA = { lat: 50.0694696, lon: 14.4449921 }

const candidate = (id: string, coords?: { lat: number; lon: number }): Candidate => ({
  id,
  url: `https://images.unsplash.com/${id}`,
  thumb: `https://images.unsplash.com/${id}?w=200`,
  description: 'a park',
  credit: { name: 'Jakub Kriz', link: 'https://unsplash.com/@jakubkriz' },
  ...(coords ? { coords } : {}),
  downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
})

/** Shaped from a real Unsplash search response. */
const stub = (photos: Array<Record<string, unknown>>) =>
  (async () => ({ ok: true, json: async () => ({ results: photos }) })) as unknown as typeof fetch

test('only coordinates earn a place its own name', () => {
  // Not the title, not the tags, not the order Unsplash returned them in —
  // those are what put the wrong park at the top of the list to begin with.
  const near = candidate('right', { lat: 50.0695, lon: 14.4451 })
  const far = candidate('wrong', { lat: 50.0875, lon: 14.4213 })
  assert.equal(verifiedAt([far, near], GREBOVKA)?.id, 'right')
  assert.equal(verifiedAt([far], GREBOVKA), undefined)
})

test('a photograph with no coordinates is never verified', () => {
  assert.equal(verifiedAt([candidate('untagged')], GREBOVKA), undefined)
})

test('the radius is tight, because the next building is the failure', () => {
  assert.equal(NAMED_METRES, 150)
  // Roughly 300 m away: the next block.
  const nextBlock = candidate('near-ish', { lat: 50.0722, lon: 14.4449 })
  assert.equal(verifiedAt([nextBlock], GREBOVKA), undefined)
})

test('an unverified photograph is kept, and captioned as atmosphere', () => {
  const chosen = choose({ kind: 'place', id: 'g' }, [candidate('a')], GREBOVKA)
  assert.equal(chosen?.photo.claim, 'atmosphere')
  assert.equal(chosen?.photo.chosenBy, 'auto')
})

test('a verified photograph may be captioned by name', () => {
  const chosen = choose({ kind: 'place', id: 'g' }, [candidate('a'), candidate('b', GREBOVKA)], GREBOVKA)
  assert.equal(chosen?.photo.claim, 'named')
  assert.equal(chosen?.photo.unsplashId, 'b', 'the verified one wins even though it is second')
})

test('nothing found is an ordinary answer, not an error', () => {
  assert.equal(choose({ kind: 'place', id: 'g' }, [], GREBOVKA), undefined)
})

test('a person who picks a photograph has vouched for it', () => {
  // The mitigation the whole matching rule leans on: somebody who knows what
  // the place looks like has supplied the evidence coordinates stood in for.
  const photo = vouchedFor({ kind: 'place', id: 'g' }, candidate('hand-picked'))
  assert.equal(photo.claim, 'named')
  assert.equal(photo.chosenBy, 'person')
})

test('credit is carried on everything, whatever the licence says', () => {
  // The licence calls attribution optional; the API guidelines require it, and
  // we pull through the API.
  const chosen = choose({ kind: 'place', id: 'g' }, [candidate('a')], GREBOVKA)
  assert.deepEqual(chosen?.photo.credit, { name: 'Jakub Kriz', link: 'https://unsplash.com/@jakubkriz' })
})

test('a search that fails returns nothing rather than throwing', async () => {
  const boom = (async () => {
    throw new Error('ENOTFOUND')
  }) as unknown as typeof fetch
  assert.deepEqual(await search('anything', { accessKey: 'k', fetchImpl: boom }), [])
})

test('a photograph missing the fields we need is dropped, not half-used', async () => {
  const results = await search('x', {
    accessKey: 'k',
    fetchImpl: stub([
      { id: 'no-user', urls: { regular: 'u', small: 's' }, links: { download_location: 'd' } },
      {
        id: 'complete',
        urls: { regular: 'u', small: 's' },
        links: { download_location: 'd' },
        user: { name: 'A', links: { html: 'h' } },
        location: { position: { latitude: 50, longitude: 14 } },
      },
    ]),
  })
  assert.equal(results.length, 1)
  assert.equal(results[0]?.id, 'complete')
  assert.deepEqual(results[0]?.coords, { lat: 50, lon: 14 })
})

test('the city is guessed from the trip title and appended to the query', () => {
  const trip = { id: 't', title: '5 days in Prague', places: [], legs: [] } as Trip
  assert.equal(cityFrom(trip), 'Prague')
  const place: Place = { id: 'g', name: 'Grébovka', coords: GREBOVKA, dayIndex: 1 }
  assert.equal(queryFor(place, 'Prague'), 'Grébovka Prague')
})

test('a place already naming its city is not told twice', () => {
  const place: Place = { id: 'b', name: 'Prague Boats', coords: GREBOVKA, dayIndex: 1 }
  assert.equal(queryFor(place, 'Prague'), 'Prague Boats')
})

test('one opener per day, not one photograph per stop', async () => {
  // A stock photo against every one of thirty-three stops looks like a content
  // farm. Sparse is both better-looking and more honest.
  const trip: Trip = {
    id: 't',
    title: 'Prague',
    places: [
      { id: 'a', name: 'A', coords: GREBOVKA, dayIndex: 1 },
      { id: 'b', name: 'B', coords: GREBOVKA, dayIndex: 1 },
      { id: 'c', name: 'C', coords: GREBOVKA, dayIndex: 2 },
      { id: 'idea', name: 'Maybe', coords: GREBOVKA },
    ],
    legs: [],
  }
  const photos = await illustrate(trip, {
    accessKey: 'k',
    fetchImpl: stub([
      {
        id: 'p',
        urls: { regular: 'u', small: 's' },
        links: { download_location: 'd' },
        user: { name: 'A', links: { html: 'h' } },
      },
    ]),
  })
  assert.equal(photos.length, 2)
  assert.deepEqual(
    photos.map((p) => p.subject.id),
    ['a', 'c'],
  )
})

test("the traveller's own photograph outranks anything we could find", async () => {
  // They were there. No verification needed and no search made.
  let searched = false
  const trip: Trip = {
    id: 't',
    title: 'Prague',
    places: [{ id: 'a', name: 'A', coords: GREBOVKA, dayIndex: 1, photoUrl: 'https://theirs/photo.jpg' }],
    legs: [],
  }
  const photos = await illustrate(trip, {
    accessKey: 'k',
    fetchImpl: (async () => {
      searched = true
      return { ok: true, json: async () => ({ results: [] }) }
    }) as unknown as typeof fetch,
  })
  assert.equal(searched, false)
  assert.equal(photos[0]?.claim, 'named')
  assert.equal(photos[0]?.chosenBy, 'person')
  assert.equal(photos[0]?.url, 'https://theirs/photo.jpg')
})
