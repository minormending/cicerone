import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { brief, notATripId, readGuide, viaPoints } from '../cli/cicerone.ts'
import type { Passage, RouteFact, Trip } from '../src/domain/types.ts'

/*
 * The seam between a hand-written file and the database.
 *
 * Both of the things tested here shipped broken, and both broke at the last
 * step of the documented workflow rather than the first — which is the
 * expensive place for a thing to break, because by then you believe the work
 * is done. Neither could be tested at all until the CLI stopped calling
 * main() on import.
 */

const scratch = (name: string, body: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'cicerone-')), name)
  writeFileSync(path, JSON.stringify(body))
  return path
}

const TRIP: Trip = {
  id: 't',
  title: 'Prague',
  departsOn: '2026-10-14',
  places: [
    { id: 'vitus', name: 'St. Vitus Cathedral', coords: { lat: 50.0909, lon: 14.4005 }, dayIndex: 1, arrive: '09:40' },
  ],
  legs: [],
}

const passage = (extra: Partial<Passage> = {}): Passage =>
  ({
    id: 'p1',
    subject: { kind: 'place', id: 'vitus' },
    kind: 'origin',
    title: 'A title',
    body: 'Several sentences of prose, long enough to be a passage rather than a field.',
    claims: [],
    sources: [],
    ...extra,
  }) as Passage

test('a hand-written passage is dated, because the column will not take null', () => {
  // `check` passed and `save` then died on a NOT NULL constraint, with a
  // Postgres error for a message, at the very last step of the workflow the
  // skill documents. The skill's own example passage carries no date and
  // should not have to.
  const written = passage()
  delete (written as Partial<Passage>).writtenAt
  const file = scratch('passages.json', [written])

  const guide = readGuide(file, TRIP, 'trip-id')
  const mine = guide.passages.find((p) => p.id === 'p1')
  assert.ok(mine)
  assert.match(mine.writtenAt, /^\d{4}-\d{2}-\d{2}$/)
})

test('a passage that came back out of the database keeps its own date', () => {
  // Otherwise editing one corridor backdates — or forward-dates — the whole
  // book, and `pending` decides staleness off these dates.
  const file = scratch('passages.json', [passage({ writtenAt: '2020-01-02' })])
  const guide = readGuide(file, TRIP, 'trip-id')
  assert.equal(guide.passages.find((p) => p.id === 'p1')?.writtenAt, '2020-01-02')
})

test('light passages are added and are never asked for', () => {
  // They are computed from latitude, longitude and date. A routine writing
  // them by hand replaces something that cannot be wrong with something that
  // can, so a computed passage in the file is dropped rather than trusted.
  const file = scratch('passages.json', [passage(), passage({ id: 'stale-light', computed: true })])
  const guide = readGuide(file, TRIP, 'trip-id')

  assert.equal(guide.passages.some((p) => p.id === 'stale-light'), false)
  const computed = guide.passages.filter((p) => p.computed)
  assert.ok(computed.length > 0, 'the real ones are added here')
  assert.ok(computed.every((p) => p.writtenAt))
})

test('a file path where a trip id goes is named as the npm flag problem', () => {
  // `npm run cicerone check --trip a.json b.json` has its --trip eaten by npm
  // and silently becomes `check a.json b.json`, against the live database.
  const said = notATripId('check', '.probe/trip.json')
  assert.ok(said)
  assert.match(said, /not a trip id/)
  assert.match(said, /npm run --silent cicerone -- check --trip/, 'and says how to fix it')
})

test('a real trip id is left alone, and other junk gets the usage line', () => {
  assert.equal(notATripId('save', '7f0e798b-8ed2-4a7e-b742-6cb10acd3e44'), undefined)
  assert.equal(notATripId('SAVE', '7F0E798B-8ED2-4A7E-B742-6CB10ACD3E44'), undefined)

  const said = notATripId('save', 'prague')
  assert.ok(said)
  assert.match(said, /cicerone save <id>/)
  assert.doesNotMatch(said, /--trip/, 'the flag hint is only for the mistake it explains')
})

/*
 * The two below run the CLI as a command, because the two above cannot.
 *
 * `notATripId` returning the right sentence is not the same as `check` using
 * it, and testing the function alone would have passed just as happily with
 * the call site deleted. It also guards the entry point: this file stopped
 * calling main() on import so that it could be imported, and if that guard is
 * ever wrong the CLI silently does nothing at all.
 */

const cli = (...args: string[]): { code: number | null; out: string } => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../cli/cicerone.ts', import.meta.url)), ...args], {
    encoding: 'utf8',
    // No database, no token, no network: these two paths exit before any.
    env: { ...process.env, SUPABASE_REFRESH_TOKEN: '' },
  })
  return { code: run.status, out: `${run.stdout}${run.stderr}` }
}

test('the CLI still runs when it is run', () => {
  const { code, out } = cli()
  assert.equal(code, 0)
  assert.match(out, /cicerone — the seam between the routine and the database/)
})

test('check refuses a file path where a trip id goes, before touching anything', () => {
  // This argv is what npm hands over after eating the --trip: the flag is
  // simply gone, which is why the mistake is silent. Invoked directly the
  // flag survives and the offline path runs, so the bug only exists on the
  // documented command, which is the worst place for it.
  const { code, out } = cli('check', 'trip.json', 'passages.json')
  assert.notEqual(code, 0)
  assert.match(out, /"trip\.json" is not a trip id/)
  assert.match(out, /npm run --silent cicerone -- check --trip/)
  assert.doesNotMatch(out, /uuid/i, 'and it never reached Postgres to be told so')
})

test('the flag surviving means the offline check, not the database', () => {
  // The other half of the same story: with --trip intact there is no trip id
  // to validate and nothing may be read from the database. It gets as far as
  // opening the file, which is the correct place to fail on a missing one.
  const { out } = cli('check', '--trip', 'no-such-trip.json', 'no-such-passages.json')
  assert.match(out, /Could not read no-such-trip\.json/)
  assert.doesNotMatch(out, /not a trip id/)
})

// ---- what the routine is handed ----

const walkRoute = (points: number): RouteFact => ({
  metres: 529.2,
  seconds: 360,
  mode: 'walk',
  path: Array.from({ length: points }, (_, i) => ({ lat: 50.078 + i / 10000, lon: 14.432 })),
})

const routedTrip = (docMode: RouteFact['mode']): Trip => ({
  id: 't',
  title: 'Prague',
  departsOn: '2026-10-14',
  places: [
    { id: 'hotel', name: 'Hotel', placeId: 'H', coords: { lat: 50.0781, lon: 14.432 }, dayIndex: 1, arrive: '10:00' },
    { id: 'banh', name: 'Banh Mi', placeId: 'B', coords: { lat: 50.0742, lon: 14.4345 }, dayIndex: 1, arrive: '11:00' },
  ],
  legs: [],
  stays: [{ name: 'Hotel', placeId: 'H', checkIn: '2026-10-15', checkOut: '2026-10-18' }],
  routes: { 'H>B': { ...walkRoute(40), mode: docMode } },
})

test('the brief hands over the figures the corridor head will print', () => {
  // A passage saying "twenty minutes" under a head saying 25 MIN is the book
  // contradicting itself in adjacent lines. The writer gets the page's string.
  const corridor = brief(routedTrip('walk')).corridors[0]
  assert.equal(corridor?.route?.shown, '530 m \u00B7 6 min')
  assert.equal(corridor?.route?.minutes, 6)
  assert.equal(corridor?.route?.via.length, 8, 'a handful of points, not the whole line')
  assert.equal(corridor?.plannerMode, undefined)
})

test('the brief says when the planner routed a corridor differently', () => {
  const corridor = brief(routedTrip('transit')).corridors[0]
  assert.equal(corridor?.route, undefined, 'a tram line is not attached to a walk')
  assert.equal(corridor?.plannerMode, 'transit')
})

test('a visit to the booked hotel is marked, so the routine can tell it is the stay', () => {
  const places = brief(routedTrip('walk')).places
  assert.equal(places.find((p) => p.id === 'hotel')?.stay, true)
  assert.equal(places.find((p) => p.id === 'banh')?.stay, undefined)
})

test('via points come from inside the route and never repeat its ends', () => {
  const route = walkRoute(100)
  const via = viaPoints(route)
  assert.equal(via.length, 8)
  assert.ok(!via.includes(route.path[0]!) && !via.includes(route.path[99]!))
  // A short route gives what it has rather than inventing points.
  assert.equal(viaPoints(walkRoute(4)).length, 2)
})
