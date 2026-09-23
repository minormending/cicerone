import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayTitle, escapeHtml, paragraphs, renderBook, routeSvg, shortName } from '../src/render/book.ts'
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
    guide([passage(), passage({ id: 'l', kind: 'look_for', computed: true, body: 'Lit 16:12–17:04 today.' })]),
    { corridors: [] },
  )
  assert.ok(html.includes('no source needed'))
})

test('a computed passage does not justify a stop on its own', () => {
  // Thirty-three headings each followed by one line of golden hour, several of
  // them identical. The padding this design refuses, arriving through the back
  // door of having computed something.
  const html = renderBook(
    TRIP,
    guide([
      passage({ id: 'o', body: 'A real passage about the cathedral and who paid for it.' }),
      passage({ id: 'l', kind: 'look_for', computed: true, subject: { kind: 'place', id: 'stern' }, body: 'Lit late.' }),
    ]),
    { corridors: [] },
  )
  assert.ok(html.includes('id="place-vitus"'))
  assert.ok(!html.includes('id="place-stern"'), 'nothing was written about it')
})

test('a computed passage does not justify a chapter on its own', () => {
  // Day one of the real Prague trip was an airport with a golden-hour note
  // against it and nothing else. That is a page of padding wearing a
  // chapter's clothes, and light rides along rather than carrying a day.
  const html = renderBook(
    TRIP,
    guide([passage({ kind: 'look_for', computed: true, body: 'Lit 16:12–17:04 today.' })]),
    { corridors: [] },
  )
  assert.ok(!html.includes('class="day"'))
})

test('the headline is the history, not the golden hour', () => {
  // Sorted by name, look_for came before origin, so every stop opened with its
  // sun times and the history sat underneath.
  const html = renderBook(
    TRIP,
    guide([
      passage({ id: 'l', kind: 'look_for', computed: true, body: 'Low warm light 07:07–08:07.' }),
      passage({ id: 'o', kind: 'origin', body: 'Charles IV laid the first stone and never saw it finished.' }),
    ]),
    { corridors: [] },
  )
  assert.ok(html.indexOf('Charles IV') < html.indexOf('Low warm light'))
  assert.ok(html.indexOf('>Origin<') < html.indexOf('Charles IV'), 'and the label follows the lead passage')
})

test('a day is named after its own ends, not after a phrase', () => {
  // An invented title is the first place a guide starts sounding like a
  // brochure.
  assert.equal(
    dayTitle([place('a', 'St. Vitus Cathedral'), place('b', 'Vinohradský Parlament Restaurant')], 'Prague'),
    'St. Vitus Cathedral to Vinohradský Parlament',
  )
  assert.equal(dayTitle([place('a', 'Grébovka (Havlíčkovy sady)')], 'Prague'), 'Grébovka')
  assert.equal(dayTitle([], 'Prague'), 'Prague')
})

test('a trailing word that only says what kind of place it is comes off', () => {
  // Four lines of heading on a phone, and "Restaurant" was carrying none.
  assert.equal(shortName('Vinohradský Parlament Restaurant'), 'Vinohradský Parlament')
  assert.equal(shortName('Bistró Loreta'), 'Bistró Loreta', 'a leading word is part of the name')
  // Only words a listing appends, never ones a building is called.
  assert.equal(shortName('Šternberský Palace'), 'Šternberský Palace')
  assert.equal(shortName('St. Vitus Cathedral'), 'St. Vitus Cathedral')
  assert.equal(shortName('Charles Bridge'), 'Charles Bridge')
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

test("the day's photograph opens the chapter, not the first stop", () => {
  // Rendered inside the stop it put a picture of Prague under a heading that
  // said "Václav Havel Airport".
  const html = renderBook(
    TRIP,
    guide(
      [passage({ subject: { kind: 'place', id: 'stern' }, body: 'Something real about the palace here.' })],
      [{ subject: { kind: 'place', id: 'vitus' }, url: 'u', claim: 'atmosphere', chosenBy: 'auto' }],
    ),
    { corridors: [], city: 'Prague' },
  )
  assert.ok(html.indexOf('<figure>') < html.indexOf('class="route"'), 'above the route strip')
  assert.ok(html.indexOf('<figure>') < html.indexOf('id="place-stern"'), 'and above every stop')
  assert.ok(!html.includes('id="place-vitus"'), 'the opener itself had nothing written about it')
})

test('a photograph found by searching is captioned as the city', () => {
  // Only a person earns a name. Everything automatic is atmosphere.
  const html = renderBook(
    TRIP,
    guide(
      [passage()],
      [{ subject: { kind: 'place', id: 'vitus' }, url: 'u', claim: 'atmosphere', chosenBy: 'auto' }],
    ),
    { corridors: [], city: 'Prague' },
  )
  assert.ok(html.includes('Prague &middot;'))
  assert.ok(!html.includes('St. Vitus Cathedral &middot;'))
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
