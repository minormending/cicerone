#!/usr/bin/env node
/**
 * The seam between the routine and everything else.
 *
 * The routine is an agent: it researches and it writes, which is the half that
 * needs judgment. Everything deterministic lives here, in code that can be
 * tested and that anybody can run without a model in the loop.
 *
 * That split is what keeps the choice of runner cheap. Today a scheduled
 * Claude Code task on one machine calls these commands; moving to a GitHub
 * Actions cron with the Agent SDK later is a runner swap, because the tools
 * it calls do not change.
 *
 *   cicerone pending              trips with no guide, or one gone stale
 *   cicerone trip <id>            the trip graph and its corridors, as JSON
 *   cicerone save <id> <file>     check a guide, then write it
 *   cicerone check <id> [file]    check without writing
 *   cicerone import <key>         fetch a Wanderlog trip and store it
 *   cicerone photos <id>          find and store a photograph per subject
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { checkGuide, substantiatedShare, type CheckResult } from '../src/check.ts'
import { corridorsOf } from '../src/corridor/waking.ts'
import { withLegs } from '../src/corridor/legs.ts'
import { lightPassages } from '../src/light/light.ts'
import { Store } from '../src/backend/store.ts'
import { fetchTrip, tripUrl } from '../src/import/wanderlogApi.ts'
import { tripFromWanderlog } from '../src/import/wanderlog.ts'
import { illustrate } from '../src/photos/illustrate.ts'
import type { Guide, Passage, Trip } from '../src/domain/types.ts'

const USAGE = `cicerone — the seam between the routine and the database

  cicerone pending                 trips with no guide, or one gone stale
  cicerone trip <id>               the trip graph and its corridors, as JSON
  cicerone save <id> <file.json>   check a guide, then write it
  cicerone check <id> [file.json]  check without writing
  cicerone check --trip <trip.json> <passages.json>   check with no database
  cicerone import <wanderlog-key>  fetch a trip and store it
  cicerone photos <id>             find and store a photograph per subject

Environment:
  SUPABASE_URL, SUPABASE_ANON_KEY   the project
  SUPABASE_REFRESH_TOKEN            your session, from the web app
  UNSPLASH_ACCESS_KEY               for \`photos\` only
`

function die(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

async function connect(): Promise<Store> {
  const url = process.env['SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY']
  const refreshToken = process.env['SUPABASE_REFRESH_TOKEN']
  if (!url || !anonKey || !refreshToken) {
    die('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_REFRESH_TOKEN.')
  }

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'cicerone' },
  })
  const { data, error } = await db.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.user) {
    console.error(`Could not sign in: ${error?.message ?? 'no session'}`)
    die('Refresh tokens rotate. Copy a fresh one from the web app.')
  }
  return new Store(db, data.user.id)
}

/** The trip as the routine needs to see it: graph, corridors, what exists. */
function brief(trip: Trip) {
  const withL = withLegs(trip)
  const corridors = corridorsOf(withL)
  const byId = new Map(withL.places.map((p) => [p.id, p]))

  return {
    trip: { id: withL.id, title: withL.title, departsOn: withL.departsOn },
    places: withL.places
      .filter((p) => p.dayIndex !== undefined)
      .map((p) => ({
        id: p.id,
        name: p.name,
        day: p.dayIndex,
        arrive: p.arrive,
        coords: p.coords,
        country: p.countryCode,
        note: p.note,
      })),
    corridors: corridors.map((c) => ({
      id: c.id,
      day: c.dayIndex,
      mode: c.mode,
      view: c.view,
      from: byId.get(c.fromPlaceId)?.name,
      to: byId.get(c.toPlaceId)?.name,
      fromCoords: byId.get(c.fromPlaceId)?.coords,
      toCoords: byId.get(c.toPlaceId)?.coords,
      // `passing` where they can see out; `prepare` where they cannot.
      writable: c.view === 'open' ? ['passing', 'event', 'look_for'] : ['prepare'],
    })),
  }
}

function report(result: CheckResult): void {
  const c = result.coverage
  const share = Math.round(substantiatedShare(c) * 100)
  console.log(
    `${c.passages} passages · ${c.placesWritten}/${c.places} places · ` +
      `${c.corridorsWritten}/${c.corridors} corridors · ${share}% carry a sourced claim`,
  )
  if (c.atmosphere > c.substantiated && c.substantiated + c.atmosphere > 4) {
    console.log(
      `  note: ${c.atmosphere} of ${c.substantiated + c.atmosphere} researched passages are atmosphere.\n` +
        '  A guide made mostly of atmosphere is the failure this design exists to avoid.',
    )
  }
  for (const fault of result.faults) {
    console.error(`  ${fault.rule}  ${fault.passageId}: ${fault.detail}`)
  }
}

/** A guide file is the passages the routine wrote; light is added here. */
function readGuide(file: string, trip: Trip, tripId: string): Guide {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    die(`Could not read ${file}: ${(err as Error).message}`)
  }
  const written = Array.isArray(parsed) ? parsed : (parsed as { passages?: Passage[] }).passages
  if (!Array.isArray(written)) die(`${file} should be an array of passages, or {"passages": [...]}.`)

  // Computed light passages are added rather than asked for. The routine has
  // no way to work them out and should not be spending attention trying.
  const researched = written.filter((p) => !p.computed)
  return {
    tripId,
    passages: [...researched, ...lightPassages(trip)],
    photos: [],
    builtAt: new Date().toISOString().slice(0, 10),
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE)
    return
  }

  if (command === 'pending') {
    const store = await connect()
    const trips = await store.pending()
    if (trips.length === 0) {
      console.log('Nothing pending. Every trip has a guide no older than its import.')
      return
    }
    for (const trip of trips) {
      console.log(`${trip.id}\t${trip.departsOn ?? '????-??-??'}\t${trip.title}`)
    }
    return
  }

  if (command === 'trip') {
    const id = rest[0]
    if (!id) die('cicerone trip <id>')
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)
    console.log(JSON.stringify(brief(saved.graph), null, 2))
    return
  }

  // Offline check: no database, no session, no network. The routine iterates
  // against this while it writes, and anybody can run it over a pair of files.
  if (command === 'check' && rest[0] === '--trip') {
    const tripFile = rest[1]
    const passageFile = rest[2]
    if (!tripFile || !passageFile) die('cicerone check --trip <trip.json> <passages.json>')

    let graph: Trip
    try {
      const parsed = JSON.parse(readFileSync(tripFile, 'utf8')) as Trip | { graph: Trip }
      graph = 'graph' in parsed ? parsed.graph : parsed
    } catch (err) {
      die(`Could not read ${tripFile}: ${(err as Error).message}`)
    }

    const withL = withLegs(graph)
    const guide = readGuide(passageFile, withL, graph.id)
    const result = checkGuide({ trip: withL, corridors: corridorsOf(withL), guide })
    report(result)
    if (!result.ok) die(`\n${result.faults.length} fault(s).`)
    return
  }

  if (command === 'check' || command === 'save') {
    const id = rest[0]
    if (!id) die(`cicerone ${command} <id> <file.json>`)
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)

    const withL = withLegs(saved.graph)
    const corridors = corridorsOf(withL)
    const file = rest[1]

    const guide = file ? readGuide(file, withL, id) : await store.getGuide(id)
    const result = checkGuide({ trip: withL, corridors, guide })
    report(result)

    if (!result.ok) die(`\n${result.faults.length} fault(s). Nothing was written.`)
    if (command === 'check') return

    await store.savePassages(id, guide.passages)
    console.log(`\nSaved ${guide.passages.length} passages to ${saved.title}.`)
    return
  }

  if (command === 'import') {
    const key = rest[0]
    if (!key) die('cicerone import <wanderlog-key>')
    const store = await connect()

    const fetched = await fetchTrip(key)
    if (!fetched.ok) die(`Could not fetch ${key}: ${fetched.reason}`)

    const { trip, report: imported } = tripFromWanderlog(fetched.document, {})
    const scheduled = imported.places - imported.unscheduled
    if (scheduled === 0) die(`${tripUrl(key)} has no scheduled stops.`)

    const tripId = await store.saveTrip({
      title: trip.title,
      ...(trip.departsOn ? { departsOn: trip.departsOn } : {}),
      source: 'wanderlog',
      sourceKey: key,
      graph: withLegs(trip),
    })
    const corridors = corridorsOf(withLegs(trip))
    console.log(`${tripId}\t${trip.title}`)
    console.log(
      `${scheduled} stops, ${corridors.length} corridors` +
        (imported.unscheduled > 0 ? `, ${imported.unscheduled} places left in standing lists` : ''),
    )
    return
  }

  if (command === 'photos') {
    const id = rest[0]
    if (!id) die('cicerone photos <id>')
    if (!process.env['UNSPLASH_ACCESS_KEY']) die('Set UNSPLASH_ACCESS_KEY.')
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)

    const found = await illustrate(withLegs(saved.graph), {
      accessKey: process.env['UNSPLASH_ACCESS_KEY'] as string,
      onProgress: (done, total) => process.stderr.write(`\r  ${done}/${total}`),
    })
    process.stderr.write('\r')
    for (const photo of found) await store.savePhoto(id, photo)

    const named = found.filter((p) => p.claim === 'named').length
    console.log(`${found.length} photographs · ${named} can be captioned by name, ${found.length - named} as atmosphere`)
    return
  }

  die(`Unknown command "${command}".\n\n${USAGE}`)
}

await main()
