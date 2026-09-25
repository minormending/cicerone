import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fingerprint, planReimport, reconcile } from '../src/import/reconcile.ts'
import { tripFromWanderlog } from '../src/import/wanderlog.ts'
import { Store, type CiceroneClient } from '../src/backend/store.ts'
import type { Passage, Photo, Place, Trip } from '../src/domain/types.ts'

/*
 * The week after the Prague book was finished, its trip gained five stops,
 * lost two and had its third afternoon reordered. A re-import would have
 * dropped nineteen passages off the page purely because the stops after the
 * first insertion were renumbered, and `check` would then have refused every
 * save. These tests are that week, at the smallest size that shows it.
 */

// ---- the ids themselves -------------------------------------------------------

test('a stop is keyed by its Wanderlog block, not by where it falls in the trip', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/wanderlog-prague.json', import.meta.url), 'utf8'))
  const { trip } = tripFromWanderlog(doc)
  const scheduled = trip.places.filter((p) => p.dayIndex !== undefined)
  assert.ok(scheduled.every((p) => /^place:\d+$/.test(p.id)), 'every stop has a block id')
  assert.ok(scheduled.every((p) => p.id === `place:${p.sourceId}`))
  assert.equal(new Set(trip.places.map((p) => p.id)).size, trip.places.length, 'and no two share one')
})

test('a document with no block ids still imports, under the old positional ids', () => {
  const doc = {
    tripPlan: {
      title: 'Hand-built',
      itinerary: {
        sections: [
          {
            heading: '',
            date: '2026-10-15',
            blocks: [{ place: { name: 'Bakery', geometry: { location: { lat: 50.07, lng: 14.43 } } } }],
          },
        ],
      },
    },
  }
  const { trip } = tripFromWanderlog(doc)
  assert.equal(trip.places[0]?.id, 'place:0:bakery')
  assert.equal(trip.places[0]?.sourceId, undefined)
})

// ---- reconcile -------------------------------------------------------------------

let n = 0
const stop = (sourceId: string | undefined, name: string, day: number, extra: Partial<Place> = {}): Place => ({
  id: sourceId ? `place:${sourceId}` : `place:${n}:${name.toLowerCase()}`,
  ...(sourceId ? { sourceId } : {}),
  name,
  // Close enough together to be walks, far enough apart to be distinct.
  coords: { lat: 50.08 + ++n / 2000, lon: 14.42 + n / 2000 },
  dayIndex: day,
  ...extra,
})
const tripOf = (places: Place[]): Trip => ({ id: 't', title: 'Prague', places, legs: [] })

test('inserting a stop keeps every other stop, and every corridor it does not split', () => {
  const [a, b, c] = [stop('1', 'Bakery', 3), stop('2', 'Cathedral', 3), stop('3', 'Gallery', 3)]
  const inserted = stop('9', 'Banh Mi', 3)
  const r = reconcile(tripOf([a, b, c]), tripOf([inserted, a, b, c]))

  for (const p of [a, b, c]) assert.equal(r.rekey.get(`place:${p.id}`), p.id, `${p.name} keeps its id`)
  assert.equal(r.rekey.get(`corridor:corridor:${a.id}:${b.id}`), `corridor:${a.id}:${b.id}`)
  assert.equal(r.gone.size, 0)
  assert.deepEqual(
    r.added.map((x) => x.subject.id).sort(),
    ['place:9', `corridor:place:9:${a.id}`].sort(),
  )
  assert.equal(r.newWork, true)
})

test('a stop inserted between two others retires the walk it split', () => {
  const [a, b] = [stop('1', 'Schwarzenberg', 3), stop('2', 'Sternberg', 3)]
  const loreta = stop('3', 'Loreta', 3)
  const r = reconcile(tripOf([a, b]), tripOf([a, loreta, b]))
  assert.ok(r.gone.has(`corridor:corridor:${a.id}:${b.id}`), 'the old walk is ground they no longer cross')
  assert.equal(r.added.filter((x) => x.subject.kind === 'corridor').length, 2)
})

test('dropping the last stop of a day is not new work', () => {
  const [a, b] = [stop('1', 'Opera', 3), stop('2', 'Dinner', 3)]
  const r = reconcile(tripOf([a, b]), tripOf([a]))
  assert.ok(r.gone.has(`place:${b.id}`))
  assert.equal(r.newWork, false, 'nothing to write, so the guide stays current')
  assert.equal(r.subjectsChanged, true)
})

test('dropping a stop from the middle of a day leaves a new walk to write', () => {
  // The wine bar goes, and the opera now leads straight to dinner: a stretch
  // of the city nobody has written about yet.
  const [a, b, c] = [stop('1', 'Opera', 3), stop('2', 'Wine bar', 3), stop('3', 'Dinner', 3)]
  const r = reconcile(tripOf([a, b, c]), tripOf([a, c]))
  assert.ok(r.gone.has(`place:${b.id}`))
  assert.deepEqual(r.added.map((x) => x.subject.id), [`corridor:${a.id}:${c.id}`])
  assert.equal(r.newWork, true)
})

test('a graph from before block ids is matched by day, name and occurrence', () => {
  // The hotel twice on one day: the bag drop and the check-in. They must stay
  // two different stops, in order, or one visit's passage lands on the other.
  const legacy = [
    stop(undefined, 'Hotel', 2, { arrive: '10:00' }),
    stop(undefined, 'Banh Mi', 2, { arrive: '11:00' }),
    stop(undefined, 'Hotel', 2, { arrive: '15:00' }),
  ]
  const now = [
    stop('51', 'Hotel', 2, { arrive: '11:00' }),
    stop('52', 'Banh Mi', 2, { arrive: '11:15' }),
    stop('53', 'Hotel', 2, { arrive: '15:00' }),
  ]
  const r = reconcile(tripOf(legacy), tripOf(now))
  assert.equal(r.rekey.get(`place:${legacy[0]!.id}`), 'place:51')
  assert.equal(r.rekey.get(`place:${legacy[2]!.id}`), 'place:53')
  assert.equal(r.gone.size, 0)
  assert.equal(r.newWork, false, 'moving to stable ids is not new work')
  assert.deepEqual(r.edited.map((e) => e.changes).flat().sort(), ['time 10:00 → 11:00', 'time 11:00 → 11:15'].sort())
})

test('a stop moved to another day follows its block', () => {
  const a = stop('1', 'Vineyard', 3)
  const r = reconcile(tripOf([a, stop('2', 'Opera', 3)]), tripOf([stop('2', 'Opera', 3), { ...a, dayIndex: 4 }]))
  assert.equal(r.rekey.get(`place:${a.id}`), a.id)
  assert.deepEqual(r.edited.find((e) => e.id === a.id)?.changes, ['moved from day 3 to day 4'])
})

// ---- the plan for the stored book ------------------------------------------------

const written = (id: string, subject: Passage['subject'], extra: Partial<Passage> = {}): Passage => ({
  id,
  subject,
  kind: subject.kind === 'corridor' ? 'passing' : 'origin',
  title: id,
  body: 'Several sentences of prose about the place, long enough to be a passage.',
  claims: [],
  sources: [],
  writtenAt: '2026-09-23',
  ...extra,
})

test('passages follow their stop, set aside when it leaves, and light notes are simply dropped', () => {
  const legacy = [stop(undefined, 'Opera', 3), stop(undefined, 'Wine bar', 3)]
  const now = [stop('70', 'Opera', 3, { note: 'Manon, 19:00, box 4' })]
  const r = reconcile(tripOf(legacy), tripOf(now))
  const passages = [
    written('opera', { kind: 'place', id: legacy[0]!.id }),
    written('wine', { kind: 'place', id: legacy[1]!.id }, { kind: 'table' }),
    written('wine-light', { kind: 'place', id: legacy[1]!.id }, { kind: 'look_for', computed: true }),
    // Already under the new id: a second run of an import that stopped halfway.
    written('opera-2', { kind: 'place', id: 'place:70' }, { kind: 'event' }),
  ]
  const photos: Photo[] = [{ subject: { kind: 'place', id: legacy[0]!.id }, url: 'u', claim: 'named', chosenBy: 'person' }]
  const plan = planReimport(r, passages, photos)

  assert.deepEqual(plan.rekeyPassages.map((m) => [m.id, m.to]), [['opera', 'place:70']])
  assert.deepEqual(plan.retire.map((p) => p.id), ['wine'], 'the written one is set aside')
  assert.deepEqual(plan.dropComputed, ['wine-light'], 'the computed one is regenerated anyway')
  assert.deepEqual(plan.rekeyPhotos, [{ kind: 'place', from: legacy[0]!.id, to: 'place:70' }], 'a chosen photo follows too')
  assert.deepEqual(
    plan.reread.map((x) => x.passageId).sort(),
    ['opera', 'opera-2'],
    'and both passages on the opera get reread against its new note',
  )
})

// ---- has anything changed? ------------------------------------------------------

test('the fingerprint moves with the itinerary and not with the routes', () => {
  const places = [stop('1', 'Bakery', 1, { note: 'kolace' }), stop('2', 'Cathedral', 1)]
  const base = tripOf(places)
  const rerouted: Trip = {
    ...base,
    routes: { 'A>B': { metres: 1, seconds: 1, path: [], mode: 'walk' } },
  }
  assert.equal(fingerprint(base), fingerprint(rerouted), 'Wanderlog recomputing a route is not a change')
  const renoted = tripOf([{ ...places[0]!, note: 'kolace, and a chlebicek for the pocket' }, places[1]!])
  assert.notEqual(fingerprint(base), fingerprint(renoted))
  const legacy = tripOf(places.map(({ sourceId: _drop, ...p }) => p))
  assert.notEqual(fingerprint(legacy), fingerprint(base), 'an old graph always re-imports once, onto stable ids')
})

test('a trip read back out of jsonb, keys reordered, is still unchanged', () => {
  // Postgres keeps object keys in its own order. The first daily check
  // compared plain JSON and called two untouched trips changed.
  const places = [stop('1', 'Hotel', 1)]
  const fresh: Trip = {
    ...tripOf(places),
    stays: [{ name: 'Montana Hotel', checkIn: '2026-03-14', checkOut: '2026-03-16', placeId: 'ChIJ' }],
  }
  const stored = JSON.parse(
    '{"id":"t","title":"Prague","legs":[],"places":' + JSON.stringify(places) +
      ',"stays":[{"name":"Montana Hotel","checkIn":"2026-03-14","placeId":"ChIJ","checkOut":"2026-03-16"}]}',
  ) as Trip
  assert.equal(fingerprint(stored), fingerprint(fresh))
})

// ---- the store, against an in-memory database --------------------------------------

type Row = Record<string, unknown>

/**
 * Just enough of the Supabase query builder for importTrip, backed by arrays.
 * It records every write in order, because the order is the design: set
 * aside before deleting, graph last.
 */
class FakeDb {
  tables: Record<string, Row[]> = { trips: [], passages: [], photos: [], retired_passages: [] }
  writes: string[] = []
  from(table: string) {
    return new FakeQuery(this, table)
  }
}

class FakeQuery {
  op: 'select' | 'upsert' | 'delete' | 'update' = 'select'
  filters: Array<(r: Row) => boolean> = []
  payload: Row[] | Row = []
  conflict: string[] = []
  one: 'single' | 'maybe' | null = null
  readonly db: FakeDb
  readonly table: string
  constructor(db: FakeDb, table: string) {
    this.db = db
    this.table = table
  }
  select() {
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v)
    return this
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]))
    return this
  }
  order() {
    return this
  }
  upsert(rows: Row | Row[], opts: { onConflict: string }) {
    this.op = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.conflict = opts.onConflict.split(',')
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  update(obj: Row) {
    this.op = 'update'
    this.payload = obj
    return this
  }
  maybeSingle() {
    this.one = 'maybe'
    return this
  }
  single() {
    this.one = 'single'
    return this
  }
  then(resolve: (v: unknown) => void) {
    resolve(this.run())
  }
  run(): { data: unknown; error: null } {
    const rows = this.db.tables[this.table]!
    const match = (r: Row) => this.filters.every((f) => f(r))
    if (this.op === 'select') {
      const found = rows.filter(match)
      return { data: this.one ? (found[0] ?? null) : found, error: null }
    }
    this.db.writes.push(`${this.op} ${this.table}`)
    if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter((r) => !match(r))
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      for (const r of rows.filter(match)) Object.assign(r, this.payload)
      return { data: null, error: null }
    }
    let last: Row | undefined
    for (const incoming of this.payload as Row[]) {
      const existing = rows.find((r) => this.conflict.every((k) => r[k] === incoming[k]))
      if (existing) Object.assign(existing, incoming)
      else rows.push({ id: `row${rows.length + 1}`, imported_at: 'default-now', ...incoming })
      last = existing ?? rows[rows.length - 1]
    }
    return { data: this.one ? { id: last?.['id'] } : null, error: null }
  }
}

const asRow = (tripId: string, p: Passage): Row => ({
  id: p.id,
  trip_id: tripId,
  subject_kind: p.subject.kind,
  subject_id: p.subject.id,
  kind: p.kind,
  title: p.title,
  body: p.body,
  claims: p.claims,
  sources: p.sources,
  computed: p.computed ?? false,
  written_at: p.writtenAt,
})

function seeded(graph: Trip, passages: Passage[], photos: Row[] = []) {
  const db = new FakeDb()
  db.tables['trips']!.push({
    id: 'trip-1',
    owner: 'me',
    title: graph.title,
    departs_on: null,
    source: 'wanderlog',
    source_key: 'abc',
    graph,
    imported_at: '2026-09-24T11:57:04Z',
    updated_at: '2026-09-24T11:57:04Z',
  })
  db.tables['passages']!.push(...passages.map((p) => asRow('trip-1', p)))
  db.tables['photos']!.push(...photos)
  return { db, store: new Store(db as unknown as CiceroneClient, 'me') }
}

const input = (graph: Trip) => ({ title: graph.title, source: 'wanderlog' as const, sourceKey: 'abc', graph })

test('a first import is a plain save', async () => {
  const db = new FakeDb()
  const store = new Store(db as unknown as CiceroneClient, 'me')
  const result = await store.importTrip(input(tripOf([stop('1', 'Bakery', 1)])))
  assert.equal(result.created, true)
  assert.equal(db.tables['trips']!.length, 1)
})

test('moving a finished book onto stable ids keeps every passage and photo, and leaves it current', async () => {
  const legacy = [stop(undefined, 'Bakery', 1), stop(undefined, 'Cathedral', 1)]
  const { db, store } = seeded(
    tripOf(legacy),
    [written('b', { kind: 'place', id: legacy[0]!.id }), written('c', { kind: 'place', id: legacy[1]!.id })],
    [{ trip_id: 'trip-1', subject_kind: 'place', subject_id: legacy[1]!.id, url: 'u', claim: 'named', chosen_by: 'person' }],
  )
  const result = await store.importTrip(input(tripOf([stop('1', 'Bakery', 1), stop('2', 'Cathedral', 1)])))

  assert.equal(result.created, false)
  assert.deepEqual(db.tables['passages']!.map((r) => r['subject_id']).sort(), ['place:1', 'place:2'])
  assert.equal(db.tables['photos']![0]!['subject_id'], 'place:2', 'the photo somebody chose follows its stop')
  assert.equal(db.tables['retired_passages']!.length, 0)
  assert.equal(db.tables['trips']![0]!['imported_at'], '2026-09-24T11:57:04Z', 'nothing new, so not stale')
})

test('a stop that left takes its passages into retired_passages, before anything is deleted', async () => {
  const places = [stop('1', 'Opera', 3), stop('2', 'Wine bar', 3)]
  const { db, store } = seeded(tripOf(places), [
    written('wine', { kind: 'place', id: 'place:2' }, { kind: 'table', title: 'Ask for Moravia' }),
    written('wine-light', { kind: 'place', id: 'place:2' }, { kind: 'look_for', computed: true }),
  ])
  await store.importTrip(input(tripOf([places[0]!])))

  const retired = db.tables['retired_passages']!
  assert.equal(retired.length, 1, 'the written passage is kept; the computed one is not worth keeping')
  assert.equal(retired[0]!['title'], 'Ask for Moravia')
  assert.match(String(retired[0]!['reason']), /day 3: Wine bar left the trip/)
  assert.equal(db.tables['passages']!.length, 0)
  assert.ok(
    db.writes.indexOf('upsert retired_passages') < db.writes.indexOf('delete passages'),
    'set aside first, so a run that dies in between loses nothing',
  )
  assert.equal(db.writes.at(-1), 'upsert trips', 'and the graph is saved last')
})

test('a trip with new stops is left pending for the routine', async () => {
  const places = [stop('1', 'Market', 4)]
  const { db, store } = seeded(tripOf(places), [written('m', { kind: 'place', id: 'place:1' })])
  const result = await store.importTrip(input(tripOf([...places, stop('2', 'Troja pier', 4)])))
  assert.equal(result.created === false && result.reconciliation.newWork, true)
  assert.notEqual(db.tables['trips']![0]!['imported_at'], '2026-09-24T11:57:04Z', 'imported_at moved')
})
