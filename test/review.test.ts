import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openingShape, parseNumber, reviewGuide, type ReviewNote, type ReviewRule } from '../src/review.ts'
import { checkGuide } from '../src/check.ts'
import type { Corridor, Guide, Leg, Passage, Place, Trip } from '../src/domain/types.ts'

/*
 * Every case here is a fault the first Prague book actually had, rebuilt at
 * the smallest size that shows it, next to the nearest thing that must not
 * be reported. The second half matters as much as the first: a review that
 * cries wolf on good prose teaches its reader to skip it.
 */

let n = 0
const place = (id: string, day: number, extra: Partial<Place> = {}): Place => ({
  id,
  name: id,
  coords: { lat: 50.08 + ++n / 1000, lon: 14.42 + n / 1000 },
  dayIndex: day,
  ...extra,
})

const corridor = (from: string, to: string, day: number, extra: Partial<Corridor> = {}): Corridor => ({
  id: `c:${from}:${to}`,
  legId: `l:${from}:${to}`,
  fromPlaceId: from,
  toPlaceId: to,
  mode: 'walk',
  dayIndex: day,
  view: 'open',
  ...extra,
})

const SOURCE = { url: 'https://example.org/page', title: 'Source', retrieved: '2026-09-24' }

let k = 0
const passage = (subject: Passage['subject'], body: string, extra: Partial<Passage> = {}): Passage => ({
  id: `p${++k}`,
  subject,
  kind: subject.kind === 'corridor' ? 'passing' : subject.kind === 'day' ? 'chapter' : 'origin',
  title: 'A title',
  body,
  // Claimed by default, so a case only trips the rule it is about.
  claims: [{ text: body.split(' ').slice(0, 3).join(' '), source: 0 }],
  sources: [SOURCE],
  writtenAt: '2026-09-24',
  ...extra,
})

const at = (id: string): Passage['subject'] => ({ kind: 'place', id })
const along = (c: Corridor): Passage['subject'] => ({ kind: 'corridor', id: c.id })

function review(
  places: Place[],
  corridors: Corridor[],
  passages: Passage[],
  extra: { legs?: Leg[]; snippets?: Map<string, number> } = {},
): ReviewNote[] {
  const trip: Trip = { id: 't', title: 'Prague', places, legs: extra.legs ?? [] }
  const guide: Guide = { tripId: 't', passages, photos: [], builtAt: '2026-09-24' }
  return reviewGuide({ trip, corridors, guide, ...(extra.snippets ? { snippets: extra.snippets } : {}) })
}

const rules = (notes: ReviewNote[], rule: ReviewRule) => notes.filter((x) => x.rule === rule)

// ---- openings --------------------------------------------------------------

test('a corridor that opens on its distance or duration is reported', () => {
  const [a, b] = [place('a', 2), place('b', 2)]
  const c = corridor('a', 'b', 2)
  for (const body of [
    'Six hundred metres north-east, and the street changes.',
    'Twenty-odd minutes east and steadily uphill.',
    'Four or five minutes north, and you cross the street.',
    'This is barely a walk, but look up.',
    'A few minutes through the terraces, and the city opens.',
  ]) {
    assert.equal(rules(review([a!, b!], [c], [passage(along(c), body)]), 'opening-distance').length, 1, body)
  }
})

test('a corridor whose figures come later in the sentence is not', () => {
  // "Your first walk in Prague is six minutes…" puts the walk first. The rule
  // is about opening on the number, not about mentioning it.
  const [a, b] = [place('a', 2), place('b', 2)]
  const c = corridor('a', 'b', 2)
  const notes = review([a!, b!], [c], [
    passage(along(c), 'Your first walk in Prague is six minutes through a district that was switched on.'),
    passage(at('a'), 'Six hundred metres of arcades, and every one of them was a shop.'),
  ])
  assert.equal(rules(notes, 'opening-distance').length, 0, 'and a stop may open however it likes')
})

test('an origin that opens on its construction date is reported, and one that keeps the date for later is not', () => {
  const [a] = [place('a', 1)]
  const notes = review([a!], [], [
    passage(at('a'), 'The clock was installed in 1410 and has been repaired ever since.'),
    passage(at('a'), 'Built between 1699 and 1708 for a family that wanted to be seen.', { kind: 'event' }),
  ])
  assert.equal(rules(notes, 'opening-date').length, 1, 'origin only: an event is allowed to start with its year')

  const later = review([a!], [], [
    passage(
      at('a'),
      'Before you look up at anything, look down at the paving under your feet. Charles IV laid the first stone in 1344.',
    ),
  ])
  assert.equal(rules(later, 'opening-date').length, 0)
})

test('two passages on one day that open the same way are reported together', () => {
  const [a, b, c] = [place('a', 2), place('b', 2), place('c', 3)]
  const notes = review([a!, b!, c!], [], [
    passage(at('a'), 'There is nothing to see from the hotel door.', { kind: 'nearby' }),
    passage(at('b'), 'There is one thing worth stopping for on this street.'),
    // The same opening on another day is a callback, not a formula.
    passage(at('c'), 'There is a bakery on the corner.'),
  ])
  const repeats = rules(notes, 'opening-repeat')
  assert.equal(repeats.length, 1)
  assert.equal(repeats[0]?.subject, 'day:2')
})

test('a shared article with a different noun is not a repeat', () => {
  const [a, b] = [place('a', 2), place('b', 2)]
  const notes = review([a!, b!], [], [
    passage(at('a'), 'The bridge was built to replace one the river took.'),
    passage(at('b'), 'The tram turns back into a commuter service here.'),
  ])
  assert.equal(rules(notes, 'opening-repeat').length, 0)
})

test('numbers are one shape, however they are spelled', () => {
  // Two words, which is what the repeat rule compares: the direction after
  // them is allowed to differ and the reader still hears one formula.
  assert.deepEqual(
    openingShape('Six hundred metres north-east, and', 2),
    openingShape('Seven hundred metres south-east, out of', 2),
  )
  assert.deepEqual(openingShape('Twenty-odd minutes east', 2), ['#', 'minutes'])
})

// ---- weight --------------------------------------------------------------

test('a famous stop shorter than an obscure one is reported, with the comparison', () => {
  // Charles Bridge at 99 words, the corner bakery at 449.
  const bridge = place('bridge', 2)
  const bakery = place('bakery', 3)
  const others = [1, 2, 3, 4].map((i) => place(`s${i}`, 4))
  const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ')
  const passages = [
    passage(at('bridge'), words(99)),
    passage(at('bakery'), words(449)),
    ...others.map((p) => passage(at(p.id), words(200))),
  ]
  const snippets = new Map([['bridge', 300], ['bakery', 4], ...others.map((p) => [p.id, 10] as [string, number])])
  const notes = review([bridge, bakery, ...others], [], passages, { snippets })

  const thin = rules(notes, 'thin-famous')
  assert.equal(thin.length, 1)
  assert.match(thin[0]!.detail, /bridge: 99 words from 300 snippets/)
  assert.match(thin[0]!.detail, /bakery has 449 from 4/)
  assert.equal(rules(notes, 'one-deep').length, 1, 'and it has only one passage')
})

test('without snippet counts the length rules stay quiet rather than guess', () => {
  const bridge = place('bridge', 2)
  const notes = review([bridge], [], [passage(at('bridge'), 'Short.')])
  assert.equal(rules(notes, 'thin-famous').length + rules(notes, 'one-deep').length, 0)
})

test('a well-written famous stop with two passages is not reported', () => {
  const vitus = place('vitus', 3)
  const small = [1, 2, 3].map((i) => place(`s${i}`, 3))
  const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(' ')
  const notes = review(
    [vitus, ...small],
    [],
    [
      passage(at('vitus'), words(160)),
      passage(at('vitus'), words(240), { kind: 'event' }),
      ...small.map((p) => passage(at(p.id), words(150))),
    ],
    { snippets: new Map([['vitus', 300], ['s1', 2], ['s2', 3], ['s3', 5]]) },
  )
  assert.equal(rules(notes, 'thin-famous').length + rules(notes, 'one-deep').length, 0)
})

// ---- claims, silences, ends ---------------------------------------------

test('a researched passage with no claim is listed; a chapter is not', () => {
  const [a] = [place('a', 1)]
  const notes = review([a!], [], [
    passage(at('a'), 'Twelve kilometres of ordinary estates, tram wires and a football ground.', { claims: [], sources: [] }),
    passage({ kind: 'day', id: '1' }, 'Straight off the plane into the Old Town.', { claims: [], sources: [] }),
  ])
  assert.equal(rules(notes, 'claim-free').length, 1)
})

test('every stop, corridor and day with nothing written is named', () => {
  const [a, b] = [place('a', 1), place('b', 1)]
  const c = corridor('a', 'b', 1)
  const notes = review([a!, b!], [c], [passage(at('a'), 'Something true about the first stop.')])
  const silent = rules(notes, 'silent').map((x) => x.subject).sort()
  assert.deepEqual(silent, ['corridor:c:a:b', 'day:1', 'place:b'])
})

test('a book that opens on no research is reported; a thin middle day is not', () => {
  const places = [place('a', 1), place('b', 2), place('c', 3)]
  const bare = { claims: [], sources: [] }
  const notes = review(places, [], [
    passage(at('a'), 'The flight leaves in the evening.', bare),
    passage(at('b'), 'The middle day, with nothing sourced in it.', bare),
    passage(at('c'), 'The last day carries a claim.'),
  ])
  assert.deepEqual(rules(notes, 'bare-ends').map((x) => x.subject), ['day:1'])
})

// ---- echoes ---------------------------------------------------------------

test('two passages on one day landing on the same phrase are reported', () => {
  // The tram ride and the evening walk, four hours apart, both on this.
  const [a, b, c] = [place('a', 3), place('b', 3), place('c', 4)]
  const line = 'Vinohrady is turn-of-the-century apartment blocks where people actually live.'
  const notes = review([a!, b!, c!], [], [
    passage(at('a'), `The tram climbs out of the centre. ${line}`),
    passage(at('b'), `Walk up past the caryatids. ${line}`),
    passage(at('c'), `A day later it is still true. ${line}`),
  ])
  const echoes = rules(notes, 'same-day-echo')
  assert.equal(echoes.length, 1, 'the same line a day later is a callback')
  assert.equal(echoes[0]?.subject, 'day:3')
})

test('two passages naming the same square are not an echo', () => {
  const [a, b] = [place('a', 4), place('b', 4)]
  const notes = review([a!, b!], [], [
    passage(at('a'), 'Cross to Place Saint Michel and the fountain faces you.'),
    passage(at('b'), 'From Place Saint Michel the river is one block south.'),
  ])
  assert.equal(rules(notes, 'same-day-echo').length, 0)
})

// ---- citations -------------------------------------------------------------

const cited = (url: string, claims: number): Passage =>
  passage(at('a'), 'Body text with several words in it.', {
    sources: [{ url, title: 't', retrieved: '2026-09-24' }],
    claims: Array.from({ length: claims }, () => ({ text: 'Body text', source: 0 })),
  })

test('Wikipedia carrying a fifth of the claims is reported, and less is not', () => {
  const a = place('a', 1)
  const heavy = review([a], [], [cited('https://en.wikipedia.org/wiki/X', 3), cited('https://example.org/y', 7)])
  assert.match(rules(heavy, 'citation-share')[0]?.detail ?? '', /3 of 10 claims \(30%\)/)
  const light = review([a], [], [cited('https://cs.wikipedia.org/wiki/X', 1), cited('https://example.org/y', 9)])
  assert.equal(rules(light, 'citation-share').length, 0)
})

test('a Wanderlog citation is always reported', () => {
  const notes = review([place('a', 1)], [], [cited('https://wanderlog.com/place/details/1', 1)])
  assert.match(rules(notes, 'citation-share')[0]?.detail ?? '', /wanderlog\.com, which must never be a source/)
})

// ---- figures against the heading -------------------------------------------

const routed = (c: Corridor, metres: number, minutes: number, mode: Leg['mode'] = 'walk'): Leg => ({
  id: c.legId,
  fromPlaceId: c.fromPlaceId,
  toPlaceId: c.toPlaceId,
  mode,
  route: { metres, seconds: minutes * 60, mode, path: [] },
})

test('a corridor whose first sentence disagrees with its heading is reported', () => {
  const [a, b] = [place('a', 2), place('b', 2)]
  const c = corridor('a', 'b', 2)
  const legs = [routed(c, 2100, 25)]
  const check = (body: string) => rules(review([a!, b!], [c], [passage(along(c), body)], { legs }), 'figures')

  assert.match(check('It is twenty minutes downhill to the river.')[0]?.detail ?? '', /heading prints 2\.1 km · 25 min/)
  assert.equal(check('It is twenty-five minutes downhill to the river.').length, 0)
  assert.equal(check('It is twenty-odd minutes downhill to the river.').length, 0, '"-odd" covers the next nine')
  assert.equal(check('It is five or six minutes to the square, then twenty more.').length, 1)
  assert.equal(check('About two kilometres, all of it downhill.').length, 0)
  assert.equal(check('About three hundred metres, all of it downhill.').length, 1)
})

test('only the first sentence is read, because the rest is about the world', () => {
  // The Paris corridor whose opening paragraph explained a 24-kilometre
  // eighteenth-century wall was a fact about the wall, not about tonight.
  const [a, b] = [place('a', 3), place('b', 3)]
  const c = corridor('a', 'b', 3)
  const notes = review(
    [a!, b!],
    [c],
    [passage(along(c), 'Tonight the metro follows a line Paris drew to make people pay. The tax farmers wanted a 24-kilometre wall.')],
    { legs: [routed(c, 6680, 0, 'transit')] },
  )
  assert.equal(rules(notes, 'figures').length, 0)
})

test('any time stated on a transit corridor is reported, since the book prints none', () => {
  const [a, b] = [place('a', 2), place('b', 2)]
  const c = corridor('a', 'b', 2, { mode: 'transit' })
  const notes = review(
    [a!, b!],
    [c],
    [passage(along(c), 'Forty-two minutes on the bus, and you will see nothing of the city.')],
    { legs: [routed(c, 15066, 0, 'transit')] },
  )
  assert.match(rules(notes, 'figures')[0]?.detail ?? '', /transit corridor, where the book prints no time/)
})

test('a corridor with no route is left to the prose', () => {
  const [a, b] = [place('a', 2), place('b', 2)]
  const c = corridor('a', 'b', 2)
  const notes = review([a!, b!], [c], [passage(along(c), 'Twenty minutes east and steadily uphill.')])
  assert.equal(rules(notes, 'figures').length, 0)
})

test('numbers are read as a person would write them', () => {
  assert.equal(parseNumber('six hundred'), 600)
  assert.equal(parseNumber('twenty-five'), 25)
  assert.equal(parseNumber('four hundred and fifty'), 450)
  assert.equal(parseNumber('a hundred'), 100)
  assert.equal(parseNumber('12'), 12)
  assert.equal(parseNumber('two thousand'), 2000)
  assert.equal(parseNumber('several'), undefined)
})

// ---- and it never blocks -----------------------------------------------------

test('the review is part of every check and never makes one fail', () => {
  const [a, b] = [place('a', 1), place('b', 1)]
  const c = corridor('a', 'b', 1)
  const trip: Trip = { id: 't', title: 'Prague', places: [a!, b!], legs: [] }
  const guide: Guide = {
    tripId: 't',
    photos: [],
    builtAt: '2026-09-24',
    passages: [
      passage(along(c), 'Six hundred metres north-east, and the street narrows without announcing it.', {
        claims: [],
        sources: [],
      }),
    ],
  }
  const result = checkGuide({ trip, corridors: [c], guide })
  assert.ok(result.ok, 'a formula opening and a silent stop are notes, not faults')
  assert.ok(result.review.some((x) => x.rule === 'opening-distance'))
  assert.ok(result.review.some((x) => x.rule === 'silent'))
})
