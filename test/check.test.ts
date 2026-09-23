import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkGuide, substantiatedShare, type CheckInput } from '../src/check.ts'
import type { Corridor, Guide, Passage, Trip } from '../src/domain/types.ts'

const TRIP: Trip = {
  id: 't',
  title: 'Prague',
  departsOn: '2026-09-23',
  places: [
    { id: 'vitus', name: 'St. Vitus Cathedral', coords: { lat: 50.0909, lon: 14.4005 }, dayIndex: 1 },
    { id: 'stern', name: 'Šternberský Palace', coords: { lat: 50.0904, lon: 14.3967 }, dayIndex: 1 },
    { id: 'idea', name: 'Somewhere we might go', coords: { lat: 50.07, lon: 14.43 } },
  ],
  legs: [],
}

const CORRIDORS: Corridor[] = [
  {
    id: 'corridor:vitus:stern',
    legId: 'leg:vitus:stern',
    fromPlaceId: 'vitus',
    toPlaceId: 'stern',
    mode: 'walk',
    dayIndex: 1,
    view: 'open',
  },
]

const SOURCE = { url: 'https://example.org/vitus', title: 'Chapter history', retrieved: '2026-09-23' }

function passage(extra: Partial<Passage> = {}): Passage {
  return {
    id: 'p1',
    subject: { kind: 'place', id: 'vitus' },
    kind: 'origin',
    title: 'Five hundred and eighty-five years',
    body: 'Charles IV laid the first stone and did not expect to see it finished. Nobody did.',
    claims: [],
    sources: [],
    writtenAt: '2026-09-23',
    ...extra,
  }
}

const input = (passages: Passage[]): CheckInput => ({
  trip: TRIP,
  corridors: CORRIDORS,
  guide: { tripId: 't', passages, photos: [], builtAt: '2026-09-23' },
})

const guide = (passages: Passage[]): Guide => input(passages).guide

test('a general statement needs no source', () => {
  // The guide is allowed to know things, stated generally.
  assert.equal(checkGuide(input([passage()])).ok, true)
})

test('a specific with nothing behind it is refused', () => {
  const result = checkGuide(
    input([passage({ body: 'Charles IV laid the first stone in 1344 and did not see it finished.' })]),
  )
  assert.equal(result.ok, false)
  assert.equal(result.faults[0]?.rule, 'unsourced-specific')
})

test('the same specific with a claim behind it passes', () => {
  const body = 'Charles IV laid the first stone in 1344 and did not see it finished.'
  const result = checkGuide(
    input([passage({ body, sources: [SOURCE], claims: [{ text: body, source: 0 }] })]),
  )
  assert.equal(result.ok, true)
})

test('a claim has to quote the passage it belongs to', () => {
  // A claim that says something the passage does not is attribution theatre.
  const result = checkGuide(
    input([
      passage({
        body: 'Charles IV laid the first stone in 1344.',
        sources: [SOURCE],
        claims: [{ text: 'The tower was finished in 1396.', source: 0 }],
      }),
    ]),
  )
  assert.ok(result.faults.some((f) => f.rule === 'claim-not-in-body'))
})

test('a claim pointing at a source that is not there is refused', () => {
  const body = 'Building began in 1344.'
  const result = checkGuide(input([passage({ body, claims: [{ text: body, source: 2 }] })]))
  assert.ok(result.faults.some((f) => f.rule === 'dangling-claim'))
})

test('a computed passage is exempt and may cite nothing', () => {
  const result = checkGuide(
    input([
      passage({
        kind: 'look_for',
        computed: true,
        body: 'The west-facing front is lit 16:12–17:04. Stand to the northeast with the sun behind you.',
      }),
    ]),
  )
  assert.equal(result.ok, true)
})

test('a computed passage that cites something has misunderstood itself', () => {
  const result = checkGuide(
    input([passage({ kind: 'look_for', computed: true, body: 'Lit 16:12–17:04 today.', sources: [SOURCE] })]),
  )
  assert.ok(result.faults.some((f) => f.rule === 'computed-with-sources'))
})

test('passing cannot attach to a place', () => {
  const result = checkGuide(input([passage({ kind: 'passing' })]))
  assert.ok(result.faults.some((f) => f.rule === 'wrong-subject'))
})

test('a subject that is not on the trip is refused', () => {
  const result = checkGuide(input([passage({ subject: { kind: 'place', id: 'nowhere' } })]))
  assert.ok(result.faults.some((f) => f.rule === 'unknown-subject'))
})

test('a place on no day is not a subject', () => {
  // Standing lists are not stops, and writing about them pads the guide with
  // places nobody is going to.
  const result = checkGuide(input([passage({ subject: { kind: 'place', id: 'idea' } })]))
  assert.ok(result.faults.some((f) => f.rule === 'unknown-subject'))
})

test('two passages of one kind for one subject is a duplicate', () => {
  const result = checkGuide(input([passage(), passage({ id: 'p2' })]))
  assert.ok(result.faults.some((f) => f.rule === 'duplicate'))
})

test('coverage counts what is held up, and what is only atmosphere', () => {
  const body = 'The carillon has twenty-seven bells and they were cast in 1694, which is why it sounds older than the tower.'
  const result = checkGuide(
    input([
      passage({ id: 'a', body, sources: [SOURCE], claims: [{ text: body, source: 0 }] }),
      passage({ id: 'b', kind: 'table', body: 'The beer here is poured slowly and nobody hurries you.' }),
      passage({ id: 'c', kind: 'passing', subject: { kind: 'corridor', id: 'corridor:vitus:stern' } }),
    ]),
  )
  assert.equal(result.ok, true)
  assert.equal(result.coverage.substantiated, 1)
  assert.equal(result.coverage.atmosphere, 2)
  assert.equal(result.coverage.places, 2, 'the standing-list place is not a stop')
  assert.equal(result.coverage.placesWritten, 1)
  assert.equal(result.coverage.corridorsWritten, 1)
})

test('writing nothing at all is not a fault', () => {
  // A trip where two thirds of the stops have nothing to say is a good guide.
  // Padding is the failure, and the checker must not push toward it.
  const result = checkGuide(input([]))
  assert.equal(result.ok, true)
  assert.equal(result.coverage.placesWritten, 0)
  assert.equal(substantiatedShare(result.coverage), 0)
})

test('the share is the number worth watching', () => {
  const body = 'Most of what you are looking at was rebuilt after the fire of 1541 swept the whole hill.'
  const result = checkGuide(
    input([
      passage({ id: 'a', body, sources: [SOURCE], claims: [{ text: body, source: 0 }] }),
      passage({ id: 'b', kind: 'table', body: 'Long lunches are normal here and nobody will rush you out.' }),
    ]),
  )
  assert.equal(substantiatedShare(result.coverage), 0.5)
})

test('a source that is not a URL is refused', () => {
  const result = checkGuide(
    input([passage({ sources: [{ url: 'a book I read', title: 'Somewhere', retrieved: '2026-09-23' }] })]),
  )
  assert.ok(result.faults.some((f) => f.rule === 'bad-source'))
})

test('a guide with no passages still reports its shape', () => {
  const result = checkGuide({ trip: TRIP, corridors: CORRIDORS, guide: guide([]) })
  assert.equal(result.coverage.corridors, 1)
  assert.equal(result.coverage.passages, 0)
})
