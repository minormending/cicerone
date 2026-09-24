import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateRange, dayTitle, escapeHtml, mapPoints, paragraphs, renderBook, routeSvg, shortName } from '../src/render/book.ts'
import { MAP_JS } from '../src/render/maps.ts'
import { BOOK_CSS } from '../src/render/styles.ts'
import { dayIndexFor, renderNow, whereAt } from '../src/render/now.ts'
import type { Corridor, Guide, Passage, Photo, Place, Trip } from '../src/domain/types.ts'

let nth = 0
const place = (id: string, name: string, extra: Partial<Place> = {}): Place => ({
  id,
  name,
  // Distinct per call: two stops at one coordinate have no shape to draw, and
  // a fixture that gives them one hides that.
  coords: { lat: 50.0875 + ++nth / 2000, lon: 14.42 + nth / 1500 },
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

test('a corridor head carries directions to the route it names', () => {
  const trip: Trip = {
    ...TRIP,
    places: [
      { ...TRIP.places[0]!, placeId: 'ChIJ_vitus' },
      { ...TRIP.places[1]!, placeId: 'ChIJ_stern' },
    ],
  }
  const html = renderBook(
    trip,
    guide([
      passage(),
      passage({
        id: 'c',
        kind: 'passing',
        subject: { kind: 'corridor', id: 'corridor:vitus:stern' },
        body: 'The square is not a square so much as a standoff.',
      }),
      passage({ id: 's', subject: { kind: 'place', id: 'stern' }, body: 'Built to out-face the palace opposite.' }),
    ]),
    { corridors: [CORRIDOR] },
  )

  const head = html.slice(html.indexOf('corridor-head'), html.indexOf('corridor-body'))
  const href = /href="(https:\/\/www\.google\.com\/maps\/dir\/[^"]+)"/.exec(head)
  assert.ok(href, 'the link is in the corridor head, not somewhere under the prose')
  const url = new URL(href[1]!.replaceAll('&amp;', '&'))
  assert.equal(url.searchParams.get('origin_place_id'), 'ChIJ_vitus')
  assert.equal(url.searchParams.get('destination_place_id'), 'ChIJ_stern')
  assert.equal(url.searchParams.get('travelmode'), 'walking')
  // The click must not tell Google which document it came from: this one has
  // somebody's hotel in it.
  assert.match(head, /rel="noreferrer noopener"/)
})

test('directions are hidden on paper, where there is nothing to click', () => {
  assert.match(BOOK_CSS, /\.corridor-head \.directions \{ display: none; \}/)
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

test('one stop draws no route, and neither do two in the same spot', () => {
  const at = (id: string, lat: number, lon: number): Place => ({ id, name: id, coords: { lat, lon }, dayIndex: 1 })
  assert.equal(routeSvg([at('a', 50.08, 14.42)]), '')
  assert.equal(routeSvg([at('a', 50.08, 14.42), at('b', 50.08, 14.42)]), '')
})

test('the drawing keeps the shape of the day rather than filling the box', () => {
  // Stretching each axis to fill a 10:1 frame turned every route into a
  // horizontal line whatever it actually looked like.
  const at = (id: string, lat: number, lon: number): Place => ({ id, name: id, coords: { lat, lon }, dayIndex: 1 })
  // Three stops running due north: no east-west spread at all.
  const svg = routeSvg([at('a', 50.080, 14.42), at('b', 50.085, 14.42), at('c', 50.090, 14.42)])
  const xs = [...svg.matchAll(/cx="([\d.]+)"/g)].map((m) => Number(m[1]))
  const ys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.equal(new Set(xs).size, 1, 'a north-south day draws as a vertical line')
  assert.ok(Math.max(...ys) - Math.min(...ys) > 200, 'and uses the height it has')
})

test('a transfer is left off the map rather than flattening it', () => {
  // Day two starts at an airport twelve kilometres away and spends the rest of
  // itself inside one square kilometre. Fitting both put the airport at the
  // far edge and squashed the whole day into a scribble.
  const at = (id: string, lat: number, lon: number): Place => ({ id, name: id, coords: { lat, lon }, dayIndex: 1 })
  const day = [
    at('airport', 50.1018, 14.2632),
    at('hotel', 50.0781, 14.4320),
    at('square', 50.0876, 14.4212),
    at('clock', 50.0870, 14.4207),
  ]
  assert.deepEqual(mapPoints(day).map((p) => p.id), ['hotel', 'square', 'clock'])
  // And a day that genuinely is spread out keeps every stop.
  const spread = [at('a', 50.0, 14.0), at('b', 51.0, 15.0), at('c', 52.0, 16.0)]
  assert.equal(mapPoints(spread).length, 3)
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

test('an imported picture does not claim to be yours', () => {
  // A small lie about authorship, in a book whose whole argument is that it
  // does not make those.
  const html = renderBook(
    TRIP,
    guide([passage()], [{ subject: { kind: 'place', id: 'vitus' }, url: 'u', claim: 'named', chosenBy: 'import' }]),
    { corridors: [], city: 'Prague' },
  )
  assert.ok(html.includes('From your itinerary'))
  assert.ok(!html.includes('Your own photograph'))
})

test('a chapter hands the map the coordinates it needs', () => {
  // The map is not fetched: it reads the route off the element. A book saved
  // to a file has to carry its own geography.
  const html = renderBook(TRIP, guide([passage()]), { corridors: [CORRIDOR] })
  const found = html.match(/data-route="([^"]+)"/)
  assert.ok(found, 'the route block carries its coordinates')
  const route = JSON.parse((found[1] as string).replace(/&quot;/g, '"')) as Array<[number, number]>
  assert.ok(route.length >= 2)
  for (const [lon, lat] of route) {
    // Longitude first, the way GeoJSON and MapLibre want it. Prague is
    // 50.08N 14.42E, so a swap here would be loud.
    assert.ok(lon > 13 && lon < 16, `longitude first: got ${lon}`)
    assert.ok(lat > 49 && lat < 51, `latitude second: got ${lat}`)
  }
})

test('the map script survives being a string in a template literal', () => {
  // BOOK_CSS broke the build twice on a backtick inside a comment. MAP_JS is
  // the same shape and a great deal easier to get wrong, so it is checked.
  assert.ok(!MAP_JS.includes('`'), 'no backticks')
  assert.ok(!MAP_JS.includes('${'), 'no dollar-brace')
  assert.doesNotThrow(() => new Function(MAP_JS), 'parses as JavaScript')
})

test('the drawn route is still there underneath the map', () => {
  // The upgrade is additive. If the tiles never arrive — offline, blocked CDN,
  // a printer — the page is exactly as good as it was before.
  const html = renderBook(TRIP, guide([passage()]), { corridors: [CORRIDOR] })
  assert.match(html, /<div class="route" data-route="[^"]*"><svg/)
  assert.ok(MAP_JS.includes("classList.add('has-map')"), 'and only hidden once a map loads')
  assert.ok(BOOK_CSS.includes('.route.has-map svg { display: none; }'))
})

test('the route fades from the first stop to the last, so it reads in order', () => {
  // A closed loop with identical rings on it says where the day went and not
  // which way round, which is half of what a route is for.
  const at = (id: string, lat: number, lon: number): Place => ({ id, name: id, coords: { lat, lon }, dayIndex: 1 })
  const svg = routeSvg([
    at('a', 50.080, 14.400),
    at('b', 50.085, 14.410),
    at('c', 50.090, 14.420),
    at('d', 50.095, 14.430),
  ])

  const legs = [...svg.matchAll(/<path [^>]*opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.equal(legs.length, 3, 'one path per leg, each carrying its own opacity')
  assert.deepEqual([...legs].sort((x, y) => y - x), legs, 'and they only ever get fainter')
  assert.ok(legs[0] !== undefined && legs[0] > 0.8)

  const rings = [...svg.matchAll(/stroke-opacity="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.equal(rings.length, 3, 'every stop but the first, which is solid coral')
  assert.deepEqual([...rings].sort((x, y) => y - x), rings)
  // The last stop is later, not less important: it stays legible.
  assert.equal(rings.at(-1), 0.4)
})

test('the map fades the same way the drawing does', () => {
  // The two have to agree: one of them is what prints.
  assert.ok(MAP_JS.includes("'line-gradient'"), 'a true gradient along the line')
  assert.ok(MAP_JS.includes('lineMetrics: true'), 'which line-gradient needs to paint at all')
  assert.ok(MAP_JS.includes("'circle-stroke-opacity'"))
  assert.ok(MAP_JS.includes("t: index / (route.length - 1)"), 'how far through the day each stop is')
})

test('the stylesheet survives being a string in a template literal', () => {
  // This has now broken the build three times, always the same way: a
  // backtick inside a CSS comment, closing the template literal it lives in.
  // MAP_JS has been guarded since it was written; the stylesheet it was
  // modelled on never was, which is why the third one got through.
  assert.ok(!BOOK_CSS.includes('`'), 'no backticks')
  assert.ok(!BOOK_CSS.includes('${'), 'no dollar-brace')
  // Braces balance, which catches a comment that swallowed a rule.
  const open = (BOOK_CSS.match(/{/g) ?? []).length
  const close = (BOOK_CSS.match(/}/g) ?? []).length
  assert.equal(open, close, 'every rule closes')
})

test('a passage shows the title it was written with', () => {
  // Every passage carries one and `check` refuses a passage without one, and
  // for the life of the renderer none of them reached a reader: a stop with
  // three passages arrived as one undifferentiated block of prose.
  const html = renderBook(TRIP, guide([passage({ title: 'The tower nobody looks up at' })]), { corridors: [CORRIDOR] })
  assert.match(html, /<h3 class="passage-title">The tower nobody looks up at<\/h3>/)
})

test('a computed passage gets no heading', () => {
  // One line of arithmetic about the sun. A heading over it would be three
  // times the size of the thing it introduces.
  // renderBook renders the guide it is handed; the CLI is what adds the light
  // passages, so this one has to be put in by hand.
  const light = passage({ id: 'p-light', kind: 'look_for', title: 'Light and angle', computed: true,
    body: 'Low warm light 07:12\u201308:12, which is when you arrive.' })
  const html = renderBook(TRIP, guide([passage(), light]), { corridors: [CORRIDOR] })
  assert.match(html, /class="computed"/, 'the computed passage rendered')
  assert.doesNotMatch(html, /passage-title">Light and angle/)
})

test('nothing lays down a solid fill on paper', () => {
  /*
   * Twenty-three corridors printed as sand-filled slabs for the life of this
   * stylesheet. The band is a screen device; on paper it is the largest thing
   * on the page by area and a laser renders it as a grey block with the prose
   * sitting inside it. The print block has always set a coral rule on the
   * corridor, which was the intent — it just never cleared the background.
   */
  const print = BOOK_CSS.slice(BOOK_CSS.indexOf('@media print'))
  for (const selector of ['.corridor', '.route', '.own-note']) {
    const rule = print.slice(print.indexOf(`  ${selector} {`))
    assert.ok(rule.startsWith(`  ${selector} {`), `${selector} has a print rule`)
    const body = rule.slice(0, rule.indexOf('}'))
    assert.match(body, /background: none/, `${selector} clears its fill for paper`)
  }
})

test('a written chapter replaces the computed day heading', () => {
  // "Antonínovo pekařství to Vinohradský Parlament" is a true sentence about a
  // day spent in a castle, two galleries and an opera house, and it tells a
  // reader nothing. Naming a day is a judgement, so it is written.
  const chapter: Passage = {
    id: 'c1',
    subject: { kind: 'day', id: '1' },
    kind: 'chapter',
    title: 'The castle hill in the morning, Vinohrady after dark',
    body: 'Two days inside one.',
    claims: [],
    sources: [],
    writtenAt: '2026-09-23',
  }
  const html = renderBook(TRIP, guide([passage(), chapter]), { corridors: [CORRIDOR] })
  assert.match(html, /<h1>The castle hill in the morning, Vinohrady after dark<\/h1>/)
  assert.match(html, /Two days inside one\./)
  assert.doesNotMatch(html, /<h1>[^<]*Šternberský[^<]*<\/h1>/, 'the stop-to-stop heading is gone')
})

test('a day nobody named still gets a heading', () => {
  // Falling back to the first and last stop is the honest answer for a day
  // with no chapter written, and it is what every day had until now.
  const html = renderBook(TRIP, guide([passage()]), { corridors: [CORRIDOR] })
  assert.match(html, /<h1>[^<]+<\/h1>/)
  assert.match(html, /stops?/, 'and the count comes back as the lead')
})

test('a stop photograph reaches back across the rail, and stops on a phone', () => {
  // Below the prose, not beside it: the text column runs 67 characters and an
  // image taking a third of it drops that to 42. Below but full width, so it
  // reads as a plate rather than an inset — and the offset has to be undone
  // where there is no rail, or the picture leaves the screen.
  assert.match(BOOK_CSS, /\.entry-body > figure \{ margin-left: calc\(-1 \* \(var\(--rail\) \+ var\(--rail-gap\)\)\); \}/)
  const mobile = BOOK_CSS.slice(BOOK_CSS.indexOf('@media (max-width: 860px)'))
  assert.match(mobile.slice(0, mobile.indexOf('@media print')), /\.entry-body > figure \{ margin-left: 0; \}/)
})

test('a date range says the month once when both ends share it', () => {
  // "Wednesday 14 October to Sunday 18 October" is a lot of words for one
  // line on a cover, and nobody writing it by hand would repeat the month.
  assert.equal(dateRange({ ...TRIP, departsOn: '2026-10-14' }, 5), '14 – 18 October 2026')
  assert.equal(dateRange({ ...TRIP, departsOn: '2026-10-30' }, 4), '30 October – 2 November 2026')
  assert.equal(dateRange({ ...TRIP, departsOn: '2026-10-14' }, 1), '14 – 14 October 2026')
  const undated: Trip = { ...TRIP }
  delete undated.departsOn
  assert.equal(dateRange(undated, 5), '', 'a trip with no departure says nothing')
})

test('the book opens on a title page', () => {
  // It opened on "Day One" with no cover, which is the one thing every
  // printed guide has and the reason a stack of chapters is not a book.
  const october: Trip = { ...TRIP, departsOn: '2026-10-14' }
  const html = renderBook(october, guide([passage()]), { corridors: [CORRIDOR], city: 'Prague' })
  const front = html.slice(html.indexOf('<div class="wrap">'), html.indexOf('<section class="day"'))
  assert.match(front, /<header class="title-page">/)
  assert.match(front, /<h1>Prague<\/h1>/)
  assert.match(front, /14 . 14 October 2026/, 'the dates, said once')
  // The counts are the honest advertisement for what this is, and corridors
  // are on it deliberately: they are the part no other guide has.
  assert.match(front, /Stops/)
  assert.match(front, /Corridors/)
  assert.match(front, /Checked claims|Checked claim/)
})

test('the title page owns page one when it prints', () => {
  const print = BOOK_CSS.slice(BOOK_CSS.indexOf('@media print'))
  assert.match(print, /\.title-page \{ break-after: page;/)
  // The old exception kept day one on the cover's page. With a cover there
  // to break after, no .day is a first child any more, so the rule is gone —
  // though the comment explaining why still names it, which is why this looks
  // for the rule and not the string.
  assert.doesNotMatch(print, /\.day:first-child \{/)
})

test('a day with one stop has nothing to summarise', () => {
  // Day one of a trip is often an airport and an overnight flight. It was
  // carrying "1 Stops / 0 Corridors" under its own chapter heading, which
  // says nothing twice and gets the plural wrong doing it.
  const alone: Trip = { ...TRIP, places: [TRIP.places[0] as Place] }
  const html = renderBook(alone, guide([passage()]), { corridors: [] })
  // Slice from the chapter onward: the cover has its own counts and they are
  // not what this is about. An earlier version of this test cut to a marker
  // that was not there, sliced an empty string, and passed against anything.
  const day = html.slice(html.indexOf('<section class="day"'))
  assert.ok(day.length > 200, 'the day rendered at all')
  assert.doesNotMatch(day, /figure-l/, 'no counts on a one-stop day')
})

test('a day with more than one stop keeps its counts, correctly pluralised', () => {
  // Two stops joined by one corridor: the old markup said "1 Corridors".
  const html = renderBook(TRIP, guide([passage()]), { corridors: [CORRIDOR] })
  const day = html.slice(html.indexOf('<section class="day"'))
  assert.match(day, /figure-n">2<\/div><div class="figure-l">Stops</)
  assert.match(day, /figure-n">1<\/div><div class="figure-l">Corridor</)
  assert.doesNotMatch(day, /figure-l">Corridors</, 'one corridor is not Corridors')
})

test('the cover pluralises its counts too', () => {
  // Same row, same helper: a one-day trip should not read "1 Days".
  const oneDay: Trip = { ...TRIP, places: [TRIP.places[0] as Place] }
  const html = renderBook(oneDay, guide([passage()]), { corridors: [] })
  const front = html.slice(0, html.indexOf('<section class="day"'))
  assert.match(front, /figure-n">1<\/div><div class="figure-l">Day</)
  assert.match(front, /figure-n">1<\/div><div class="figure-l">Stop</)
  assert.doesNotMatch(front, /figure-l">Days</)
})
