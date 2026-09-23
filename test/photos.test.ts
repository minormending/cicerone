import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choose, describe, search, vouchedFor, type Candidate } from '../src/photos/unsplash.ts'
import { cityFrom, distinctiveWords, illustrate, photoNames, spreadOver } from '../src/photos/illustrate.ts'
import type { Trip } from '../src/domain/types.ts'

const PRAGUE = { lat: 50.0875, lon: 14.4213 }

const candidate = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  url: `https://images.unsplash.com/${id}`,
  thumb: `https://images.unsplash.com/${id}?w=200`,
  description: 'a bridge at dawn',
  credit: { name: 'Jakub Kriz', link: 'https://unsplash.com/@jakubkriz' },
  downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
  ...extra,
})

/** Shaped from a real Unsplash search response. */
const stub = (photos: Array<Record<string, unknown>>) =>
  (async () => ({ ok: true, json: async () => ({ results: photos }) })) as unknown as typeof fetch

const photo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  urls: { regular: `u/${id}`, small: `s/${id}` },
  links: { download_location: `d/${id}` },
  user: { name: 'A Photographer', links: { html: 'https://unsplash.com/@a' } },
  ...extra,
})

test('nothing found by searching may claim a name', () => {
  // The rule survived the live API; the mechanism for it did not. Coordinates
  // are null on effectively every photograph, and a location string is still
  // free text somebody typed.
  const chosen = choose({ kind: 'place', id: 'g' }, [
    candidate('a', { coords: PRAGUE, where: 'Charles bridge, Prague, Czechia' }),
  ])
  assert.equal(chosen?.photo.claim, 'atmosphere')
  assert.equal(chosen?.photo.chosenBy, 'auto')
})

test('nothing found is an ordinary answer, not an error', () => {
  assert.equal(choose({ kind: 'place', id: 'g' }, []), undefined)
})

test('a person who picks a photograph has vouched for it', () => {
  // The only route to a named caption, and the mitigation the design leans on:
  // somebody who knows what the place looks like has looked at it.
  const p = vouchedFor({ kind: 'place', id: 'g' }, candidate('hand-picked'))
  assert.equal(p.claim, 'named')
  assert.equal(p.chosenBy, 'person')
})

test('credit is carried on everything, whatever the licence says', () => {
  // The licence calls attribution optional; the API guidelines require it, and
  // we pull through the API.
  const chosen = choose({ kind: 'place', id: 'g' }, [candidate('a')])
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
    fetchImpl: stub([{ id: 'no-user', urls: { regular: 'u', small: 's' }, links: { download_location: 'd' } }, photo('complete')]),
  })
  assert.equal(results.length, 1)
  assert.equal(results[0]?.id, 'complete')
})

test('Null Island is not a location', () => {
  // Unsplash returns 0,0 rather than null for a photograph with no position,
  // and nobody stood there.
  const withZero = stub([photo('z', { location: { position: { latitude: 0, longitude: 0 } } })])
  return search('x', { accessKey: 'k', fetchImpl: withZero }).then((r) => {
    assert.equal(r[0]?.coords, undefined)
  })
})

test('where the photographer stood is read, for a human to judge', async () => {
  // Shown in the swap dialog. Good evidence for a person, and insufficient
  // evidence for a machine — which is the whole distinction.
  const full = (async () => ({
    ok: true,
    json: async () => photo('a', { location: { name: 'Charles bridge, Prague', city: 'Prague' } }),
  })) as unknown as typeof fetch
  const described = await describe(candidate('a'), { accessKey: 'k', fetchImpl: full })
  assert.equal(described.where, 'Charles bridge, Prague, Prague')
  assert.equal(described.url, 'https://images.unsplash.com/a', 'the search result keeps its own urls')
})

test('the city is guessed from the trip title', () => {
  assert.equal(cityFrom({ id: 't', title: 'Trip to Prague', places: [], legs: [] } as Trip), 'Prague')
  assert.equal(cityFrom({ id: 't', title: '5 days in Prague', places: [], legs: [] } as Trip), 'Prague')
})

test('a city name is not a distinctive word', () => {
  // A photograph tagged "prague" says nothing about which stop it is, and the
  // boilerplate Wanderlog inherits from Google listings says less.
  assert.deepEqual(distinctiveWords('Prague Astronomical Clock'), ['astronomical', 'clock'])
  assert.deepEqual(distinctiveWords('National Gallery Prague – Schwarzenberg Palace'), ['schwarzenberg', 'palace'])
  assert.deepEqual(distinctiveWords('Prague'), [])
})

test("a photograph is of a stop only when its own words say so", () => {
  // Unsplash returns the same Charles Bridge picture for "Loreta Prague" and
  // "Mr. Banh Mi Prague", so rank and result count carry no information. The
  // photographer's description and tags are the only evidence about the
  // picture rather than about the query.
  const bridge = candidate('a', { description: 'Charles Bridge at golden hour', tags: ['prague', 'bridge'] })
  assert.equal(photoNames(bridge, 'Charles Bridge'), true)
  assert.equal(photoNames(bridge, 'Loreta'), false)
  assert.equal(photoNames(bridge, 'Mr. Banh Mi'), false)

  const tagged = candidate('b', { tags: ['astronomical', 'clock', 'old town'] })
  assert.equal(photoNames(tagged, 'Prague Astronomical Clock'), true)

  // Nothing distinctive to look for means no match, not a free pass.
  assert.equal(photoNames(bridge, 'Prague'), false)
})

test('atmosphere pictures are spread through a chapter, not stacked at the top', () => {
  const stops = Array.from({ length: 14 }, (_, i) => ({
    id: `p${i}`,
    name: `Stop ${i}`,
    coords: PRAGUE,
    dayIndex: 1,
  }))
  const picked = spreadOver(stops, 3)
  assert.deepEqual(picked.map((p) => p.id), ['p0', 'p4', 'p9'])
  // Fewer stops than pictures is not an error.
  assert.equal(spreadOver(stops.slice(0, 2), 3).length, 2)
  assert.deepEqual(spreadOver([], 3), [])
})

test('being out of budget is not the same as finding nothing', async () => {
  // Swallowing this printed "0 photographs" over a trip whose pictures were
  // simply never asked for.
  const limited = (async () => ({
    ok: false,
    status: 403,
    headers: { get: (h: string) => (h === 'x-ratelimit-remaining' ? '0' : null) },
    json: async () => ({}),
  })) as unknown as typeof fetch
  await assert.rejects(() => search('Prague', { accessKey: 'k', fetchImpl: limited }), /rate limit/i)
})

test('one search covers the trip, with a hard ceiling on the rest', async () => {
  // Thirty-three searches plus a download each is about forty-eight requests
  // against a budget of fifty an hour: one trip consumed the whole hour and
  // the next run returned nothing at all.
  const trip: Trip = {
    id: 't',
    title: 'Trip to Prague',
    places: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: `Distinctive Placename ${'x'.repeat(i + 4)}`,
      coords: PRAGUE,
      dayIndex: (i % 4) + 1,
    })),
    legs: [],
  }
  let searches = 0
  await illustrate(trip, {
    accessKey: 'k',
    searchBudget: 6,
    fetchImpl: (async (url: string) => {
      if (String(url).includes('search/photos')) searches++
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }) }
    }) as unknown as typeof fetch,
  })
  assert.equal(searches, 7, 'one for the city, six targeted, and no more')
})

test('one opener per day, of the city, and never the same one twice', async () => {
  // Searching the day's first stop returned nothing on four of five days of a
  // real trip: it is a bakery, an airport and a supermarket. The city always
  // answers, and is also the only honest caption.
  const trip: Trip = {
    id: 't',
    title: 'Trip to Prague',
    places: [
      { id: 'a', name: 'Antonínovo pekařství', coords: PRAGUE, dayIndex: 1 },
      { id: 'b', name: 'Somewhere else', coords: PRAGUE, dayIndex: 1 },
      { id: 'c', name: 'Václav Havel Airport', coords: PRAGUE, dayIndex: 2 },
      { id: 'idea', name: 'Maybe', coords: PRAGUE },
    ],
    legs: [],
  }
  let queries: string[] = []
  const photos = await illustrate(trip, {
    accessKey: 'k',
    fetchImpl: (async (url: string) => {
      queries.push(String(url))
      return { ok: true, json: async () => ({ results: [photo('one'), photo('two')] }) }
    }) as unknown as typeof fetch,
  })
  assert.ok(photos.length >= 2, 'at least one per day')
  assert.ok(photos.every((p) => p.claim === 'atmosphere'))
  assert.equal(new Set(photos.map((p) => p.unsplashId)).size, photos.length, 'never the same picture twice')
  assert.ok(queries.some((q) => q.includes('Prague')))
})

test("the traveller's own photograph outranks anything we could find", async () => {
  // They were there. No verification needed and no search made for it.
  const trip: Trip = {
    id: 't',
    title: 'Trip to Prague',
    places: [{ id: 'a', name: 'A', coords: PRAGUE, dayIndex: 1, photoUrl: 'https://theirs/photo.jpg' }],
    legs: [],
  }
  const photos = await illustrate(trip, {
    accessKey: 'k',
    fetchImpl: stub([]),
  })
  assert.equal(photos[0]?.claim, 'named')
  assert.equal(photos[0]?.chosenBy, 'person')
  assert.equal(photos[0]?.url, 'https://theirs/photo.jpg')
})
