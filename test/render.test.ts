import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, paragraphs, renderBook, routeSvg } from '../src/render/book.ts'
import { dayIndexFor, renderNow, whereAt } from '../src/render/now.ts'
import type { Corridor, Guide, Passage, Photo, Place, Trip } from '../src/domain/types.ts'

const place = (id: string, name: string, extra: Partial<Place> = {}): Place => ({
  id,
  name,
  coords: { lat: 50.0875 + Number(id.length) / 1000, lon: 14.42 + Number(id.length) / 900 },
  dayIndex: 1,
  ...extra,
})

const TRIP: Trip = {
  id: 't',
  title: 'Prague',
  departsOn: '2026-09-23',
  places: [
    place('vitus', 'St. Vitus Cathedral', { arrive: '09:40' }),
    place('stern', 'Šternberský Palace', { arrive: '11:15' }),
  ],
  legs: [],
}

const CORRIDOR: Corridor = {
  id: 'corridor:vitus:stern',
  legId: 'leg:vitus:stern',
  fromPlaceId: 'vitus',
  toPlaceId: 'stern',
  mode: 'walk',
  dayIndex: 1,
  view: 'open',
}

const SOURCE = { url: 'https://example.org/vitus', title: 'Chapter history', retrieved: '2026-09-23' }

const passage = (extra: Partial<Passage> = {}): Passage => ({
  id: 'p1',
  subject: { kind: 'place', id: 'vitus' },
  kind: 'origin',
  title: 'Five hundred and eighty-five years',
  body: 'Charles IV laid the first stone and did not expect to see it finished.',
  claims: [],
  sources: [],
  writtenAt: '2026-09-23',
  ...extra,
})

const guide = (passages: Passage[], photos: Photo[] = []): Guide => ({
  tripId: 't',
  passages,
  photos,
  builtAt: '2026-09-23',
})

test('markup in a place name or a passage cannot escape', () => {
  const t: Trip = { ...TRIP, places: [place('x', '<script>alert(1)</script>', { arrive: '09:00' })] }
  const html = renderBook(t, guide([passage({ subject: { kind: 'place', id: 'x' } })]), { corridors: [] })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('escapeHtml covers the five significant characters', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;')
})

test('a claim marks the sentence it holds up, not the paragraph', () => {
  const body = 'Charles IV laid the first stone in 1344. The west front is younger than the Eiffel Tower.'
  const html = paragraphs(body, [{ text: 'Charles IV laid the first stone in 1344', source: 0 }], 0)
  assert.match(html, /in 1344<a class="claim" href="#claim-1"[^>]*>1<\/a>\./)
})

test('claims are numbered across the whole book so footnotes are stable', () => {
  const a = passage({
    id: 'a',
    body: 'Founded in 1344 by Charles IV.',
    claims: [{ text: 'Founded in 1344', source: 0 }],
    sources: [SOURCE],
  })
  const b = passage({
    id: 'b',
    kind: 'event',
    subject: { kind: 'place', id: 'stern' },
    body: 'Rebuilt after the fire of 1541.',
    claims: [{ text: 'the fire of 1541', source: 0 }],
    sources: [SOURCE],
  })
  const html = renderBook(TRIP, guide([a, b]), { corridors: [] })
  assert.ok(html.includes('id="claim-1"'))
  assert.ok(html.includes('id="claim-2"'))
  assert.equal((html.match(/class="claim"/g) ?? []).length, 2)
})

test('a computed passage says it needs no source', () => {
  const html = renderBook(
    TRIP,
    guide([passage({ kind: 'look_for', computed: true, body: 'Lit 16:12–17:04 today.' })]),
    { corridors: [] },
  )
  assert.ok(html.includes('no source needed'))
})

test('a corridor renders between the places it joins', () => {
  const html = renderBook(
    TRIP,
    guide([
      passage(),
      passage({
        id: 'c',
        kind: 'passing',
        subject: { kind: 'corridor', id: 'corridor:vitus:stern' },
        body: 'The square is not a square so much as a standoff.',
      }),
      // stern needs something written or it does not render at all, which is
      // itself the rule: a stop with nothing to say leaves no empty heading.
      passage({ id: 's', subject: { kind: 'place', id: 'stern' }, body: 'Built to out-face the palace opposite.' }),
    ]),
    { corridors: [CORRIDOR] },
  )
  // By section, not by name: both stop names also appear in the route strip
  // at the top of the chapter.
  const order = ['id="place-vitus"', 'id="corridor-corridor:vitus:stern"', 'id="place-stern"'].map((s) =>
    html.indexOf(s),
  )
  assert.ok(order.every((n) => n > -1), 'all three sections render')
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the corridor sits between the places it joins')
  assert.ok(html.includes('standoff'))
})

test('a day with nothing written is not a chapter', () => {
  // Silence is a legitimate outcome and must not leave an empty page behind.
  const html = renderBook(TRIP, guide([]), { corridors: [CORRIDOR] })
  assert.ok(!html.includes('class="day"'))
})

test('the route is drawn from the real coordinates', () => {
  const svg = routeSvg([place('a', 'A'), place('bb', 'B'), place('ccc', 'C')])
  assert.match(svg, /<path d="M[\d.]+ [\d.]+ L/)
  assert.equal((svg.match(/<circle/g) ?? []).length, 3)
})

test('one stop draws no route', () => {
  assert.equal(routeSvg([place('a', 'A')]), '')
})

test('a photograph is captioned by name only when it was verified', () => {
  const named = renderBook(
    TRIP,
    guide([passage()], [{ subject: { kind: 'place', id: 'vitus' }, url: 'u', claim: 'named', chosenBy: 'auto' }]),
    { corridors: [], city: 'Prague' },
  )
  assert.ok(named.includes('St. Vitus Cathedral &middot;'))

  const loose = renderBook(
    TRIP,
    guide([passage()], [{ subject: { kind: 'place', id: 'vitus' }, url: 'u', claim: 'atmosphere', chosenBy: 'auto' }]),
    { corridors: [], city: 'Prague' },
  )
  assert.ok(loose.includes('Prague &middot;'))
  assert.ok(!loose.includes('St. Vitus Cathedral &middot;'))
})

test('a photograph carries its credit and a swap control', () => {
  const html = renderBook(
    TRIP,
    guide(
      [passage()],
      [
        {
          subject: { kind: 'place', id: 'vitus' },
          url: 'u',
          claim: 'named',
          chosenBy: 'auto',
          credit: { name: 'Marek', link: 'https://unsplash.com/@marek' },
        },
      ],
    ),
    { corridors: [] },
  )
  assert.ok(html.includes('Marek'))
  assert.ok(html.includes('utm_source=cicerone'))
  assert.ok(html.includes('data-swap="place:vitus"'))
})

test('where they are comes from the clock', () => {
  assert.equal(whereAt(TRIP, [CORRIDOR], { dayIndex: 1, minute: 8 * 60 }).kind, 'before')
  assert.equal(whereAt(TRIP, [CORRIDOR], { dayIndex: 1, minute: 10 * 60 }).kind, 'corridor')
  assert.equal(whereAt(TRIP, [CORRIDOR], { dayIndex: 1, minute: 12 * 60 }).kind, 'after')
})

test('at a stop with a departure still ahead, they are at the stop', () => {
  const t: Trip = {
    ...TRIP,
    places: [place('vitus', 'St. Vitus Cathedral', { arrive: '09:40', depart: '10:30' }), TRIP.places[1] as Place],
  }
  const where = whereAt(t, [CORRIDOR], { dayIndex: 1, minute: 10 * 60 })
  assert.equal(where.kind, 'place')
  assert.equal(where.place?.id, 'vitus')
})

test('the day index is derived from the departure date', () => {
  assert.equal(dayIndexFor(TRIP, new Date('2026-09-23T10:00:00Z')), 1)
  assert.equal(dayIndexFor(TRIP, new Date('2026-09-22T10:00:00Z')), undefined)
})

test('a corridor in the now view leads with the passing passage', () => {
  const where = whereAt(TRIP, [CORRIDOR], { dayIndex: 1, minute: 10 * 60 })
  const html = renderNow(
    guide([
      passage({
        id: 'c',
        kind: 'passing',
        subject: { kind: 'corridor', id: 'corridor:vitus:stern' },
        body: 'Halfway across, look back at the plague column.',
      }),
    ]),
    where,
  )
  assert.ok(html.includes('Passing'))
  assert.ok(html.includes('plague column'))
  assert.ok(html.includes('St. Vitus Cathedral &rarr; Šternberský Palace'))
})

test('an enclosed corridor is labelled for boarding, not for looking', () => {
  const flight: Corridor = { ...CORRIDOR, mode: 'flight', view: 'enclosed' }
  const html = renderNow(guide([]), whereAt(TRIP, [flight], { dayIndex: 1, minute: 10 * 60 }))
  assert.ok(html.includes('Before you board'))
})

test('nothing written says so plainly rather than inventing something', () => {
  const html = renderNow(guide([]), whereAt(TRIP, [CORRIDOR], { dayIndex: 1, minute: 10 * 60 }))
  assert.ok(html.includes('Nothing written for this one'))
  assert.ok(html.includes('padding'))
})
