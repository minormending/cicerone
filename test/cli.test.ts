import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { notATripId, readGuide } from '../cli/cicerone.ts'
import type { Passage, Trip } from '../src/domain/types.ts'

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
